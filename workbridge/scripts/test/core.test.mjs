import test from "node:test";
import assert from "node:assert/strict";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  statSync,
  symlinkSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  atomicPrivate,
  readPrivate,
  safePath,
  locked,
} from "../dist/storage.js";
import {
  resourceKey,
  saveRun,
  loadRun,
  bind,
  current,
  migrate,
  start,
} from "../dist/state.js";
import { safeUrl, resource } from "../dist/contracts.js";
import {
  connectors,
  selectConnection,
  localLaunch,
} from "../dist/connectors.js";
import {
  applyHost,
  inspect,
  removeHost,
  registration,
  fingerprint,
} from "../dist/hosts.js";
import { probe } from "../dist/probe.js";
const temp = () =>
  mkdtempSync(join(realpathSync(tmpdir()), "workbridge-test-"));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fake = fileURLToPath(
  new URL("../../../tests/fixtures/fake_mcp_server.mjs", import.meta.url),
);
// Test fixtures are outside the skill when installed; this repository test resolves its own path.
const fixture = fake;
const ref = {
  provider: "tapd",
  connection: "tapd-work",
  space: "1",
  kind: "requirement",
  id: "9007199254740993",
};
function profile(host = "cursor") {
  return {
    version: 1,
    name: "demo",
    connector: "tapd",
    host,
    server: "workbridge-demo",
    transport: "stdio",
    allowWrites: true,
    state: "pending-host-reload",
  };
}
function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("private files are restricted, atomic and reject corruption/symlinks/repositories", () => {
  const dir = temp(),
    p = join(dir, "secret.json");
  atomicPrivate(p, { token: "fixture" });
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(readPrivate(p), { token: "fixture" });
  chmodSync(p, 0o644);
  assert.throws(() => readPrivate(p), { code: "UNSAFE_PERMISSIONS" });
  chmodSync(p, 0o600);
  writeFileSync(p, "{broken");
  assert.throws(() => atomicPrivate(p, {}), { code: "INVALID_PRIVATE_FILE" });
  assert.equal(readFileSync(p, "utf8"), "{broken");
  const link = join(dir, "link");
  symlinkSync(p, link);
  assert.throws(() => readPrivate(link), { code: "UNSAFE_PATH" });
  const repo = join(dir, "repo");
  mkdirSync(repo, { mode: 0o700 });
  writeFileSync(join(repo, ".git"), "gitdir: /somewhere");
  assert.throws(() => atomicPrivate(join(repo, "state.json"), {}), {
    code: "UNSAFE_PATH",
  });
});
test("resource keys isolate platform, connection, space and kind; preserve large string IDs", () => {
  assert.equal(resource(ref).id, "9007199254740993");
  for (const key of ["provider", "connection", "space", "kind"])
    assert.notEqual(resourceKey(ref), resourceKey({ ...ref, [key]: "other" }));
  assert.throws(() => resource({ ...ref, id: 123 }));
  assert.throws(() => resource({ ...ref, endpoint: "https://x" }));
});
test("routing respects explicit connection, rejects ambiguity and supports new declared connectors", () => {
  const c = connectors(),
    p = profile();
  p.name = "a";
  const q = { ...p, name: "b" };
  assert.throws(() => selectConnection("workitem.task.read", [p, q], c), {
    code: "AMBIGUOUS_CONNECTION",
  });
  assert.equal(
    selectConnection("workitem.task.read", [p, q], c, "b", "a").name,
    "b",
  );
  assert.throws(() => selectConnection("discussion.search", [p], c, "a"), {
    code: "CAPABILITY_UNAVAILABLE",
  });
  const extra = {
    ...c[0],
    id: "test-only",
    capabilities: {
      "custom.read": { version: 1, tools: ["custom_read"], write: false },
    },
  };
  assert.equal(
    selectConnection(
      "custom.read",
      [{ ...p, connector: "test-only" }],
      [...c, extra],
    ).name,
    "a",
  );
});
test("stdio secret stays in child environment and is absent from host registration", () => {
  const p = profile();
  const launch = localLaunch(p, undefined, { token: "not-in-argv" });
  assert.equal(launch.env.TAPD_ACCESS_TOKEN, "not-in-argv");
  assert(!JSON.stringify(launch.args).includes("not-in-argv"));
  assert(!JSON.stringify(registration(p, cli)).includes("not-in-argv"));
});
test("remote URLs and authentication fail closed", () => {
  for (const u of [
    "https://user:password@example.com/mcp",
    "https://example.com/mcp?token=x",
    "http://remote.example/mcp",
    "file:///a",
  ])
    assert.throws(() => safeUrl(u, true));
  assert.equal(
    safeUrl("http://127.0.0.1:8080/mcp", true),
    "http://127.0.0.1:8080/mcp",
  );
  assert.throws(
    () =>
      registration(
        {
          ...profile(),
          transport: "streamable-http",
          url: "https://x/mcp",
          auth: "bearer-env",
          bearerEnv: "TOKEN",
        },
        cli,
      ),
    { code: "UNSUPPORTED_AUTH" },
  );
  assert.equal(
    registration(
      {
        ...profile("codex"),
        transport: "streamable-http",
        url: "https://x/mcp",
        auth: "bearer-env",
        bearerEnv: "TOKEN",
      },
      cli,
    ).bearerEnv,
    "TOKEN",
  );
});
test("Cursor preserves unknown fields, verifies writes, detects concurrent changes, removes only owned entry", () => {
  const dir = temp();
  mkdirSync(join(dir, ".cursor"));
  writeFileSync(
    join(dir, ".cursor/mcp.json"),
    JSON.stringify({
      extra: 7,
      mcpServers: { other: { url: "https://example.com" } },
    }),
  );
  const p = profile();
  p.hostFingerprint = applyHost(p, cli, undefined, () => "", dir);
  const config = JSON.parse(
    readFileSync(join(dir, ".cursor/mcp.json"), "utf8"),
  );
  assert.equal(config.extra, 7);
  assert(config.mcpServers.other);
  assert.equal(
    fingerprint(inspect("cursor", p.server, () => "", dir)),
    p.hostFingerprint,
  );
  assert.throws(() => applyHost(p, cli, undefined, () => "", dir), {
    code: "HOST_CONFIG_CHANGED",
  });
  removeHost(p, () => "", dir);
  assert.equal(
    inspect("cursor", p.server, () => "", dir),
    undefined,
  );
  assert(
    JSON.parse(readFileSync(join(dir, ".cursor/mcp.json"), "utf8")).mcpServers
      .other,
  );
});
test("Codex uses CLI argv and verifies exact registration without environment secrets", () => {
  let stored;
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === "list")
      return JSON.stringify(stored ? [{ name: "workbridge-demo" }] : []);
    if (args[1] === "get") return JSON.stringify({ transport: stored });
    if (args[1] === "add") {
      stored = { command: process.execPath, args: [cli, "mcp-launch", "demo"] };
      return "";
    }
    if (args[1] === "remove") {
      stored = undefined;
      return "";
    }
  };
  const p = profile("codex");
  p.hostFingerprint = applyHost(p, cli, undefined, run);
  removeHost(p, run);
  assert(calls.some((x) => x[1][1] === "add"));
  assert(!JSON.stringify(calls).includes("TAPD_ACCESS_TOKEN"));
});
test("Claude user registration uses official CLI and reads user config only", () => {
  const dir = temp();
  writeFileSync(
    join(dir, ".claude.json"),
    JSON.stringify({ extra: 1, mcpServers: {} }),
  );
  const p = profile("claude");
  let args;
  const run = (cmd, a) => {
    args = a;
    const j = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
    j.mcpServers[p.server] = registration(p, cli);
    writeFileSync(join(dir, ".claude.json"), JSON.stringify(j));
    return "";
  };
  p.hostFingerprint = applyHost(p, cli, undefined, run, dir);
  assert.deepEqual(args.slice(0, 4), ["mcp", "add", "--scope", "user"]);
  assert.equal(
    JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8")).extra,
    1,
  );
});
test("resume preserves verified successes and rejects credentials and duplicate steps", () => {
  const old = process.env.WORKBRIDGE_HOME;
  process.env.WORKBRIDGE_HOME = temp();
  try {
    const value = {
      version: 1,
      id: "resume",
      draft: "A draft",
      results: [
        { step: "create", status: "success", verified: true, resource: ref },
      ],
    };
    saveRun(value);
    assert.deepEqual(loadRun("resume"), value);
    assert.throws(() => saveRun({ ...value, results: [] }), {
      code: "COMPLETED_STEP_CHANGED",
    });
    assert.throws(
      () =>
        saveRun({
          ...value,
          id: "other",
          draft: "Authorization: Bearer fake-token",
        }),
      { code: "SECRET_IN_STATE" },
    );
    assert.throws(
      () =>
        saveRun({
          ...value,
          id: "other",
          results: [...value.results, ...value.results],
        }),
      { code: "INVALID_RUN" },
    );
    saveRun({
      ...value,
      results: [
        ...value.results,
        { step: "reply", status: "unknown", verified: false },
      ],
    });
  } finally {
    if (old === undefined) delete process.env.WORKBRIDGE_HOME;
    else process.env.WORKBRIDGE_HOME = old;
  }
});
test("generic context binds without legacy writes; migration is explicit and repeatable", () => {
  const dir = temp(),
    state = temp(),
    prev = process.cwd(),
    old = process.env.WORKBRIDGE_HOME;
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "readme"), "x");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "init");
  process.chdir(dir);
  process.env.WORKBRIDGE_HOME = state;
  try {
    bind(ref);
    assert.deepEqual(current().resource, ref);
    assert(!existsSync(join(dir, ".tapd")));
    assert.throws(() => bind({ ...ref, id: "other" }), {
      code: "CONTEXT_CONFLICT",
    });
    const other = temp();
    process.env.WORKBRIDGE_HOME = other;
    mkdirSync(join(dir, ".tapd"));
    writeFileSync(
      join(dir, ".tapd/context.json"),
      JSON.stringify({
        version: 1,
        branches: {
          main: {
            work_item: { entity_type: "Story", workspace_id: "1", id: "2" },
          },
        },
      }),
    );
    migrate("tapd-work");
    migrate("tapd-work");
    assert.equal(current().resource.id, "2");
    assert(existsSync(join(dir, ".tapd/context.json")));
  } finally {
    process.chdir(prev);
    if (old === undefined) delete process.env.WORKBRIDGE_HOME;
    else process.env.WORKBRIDGE_HOME = old;
  }
});
test("official SDK stdio probe succeeds, checks missing tools, masks errors and times out", async () => {
  const spec = {
    command: process.execPath,
    args: [fixture],
    env: { ...process.env },
    probe: { tool: "get_user_participant_projects", args: {} },
  };
  assert.equal((await probe(spec)).ok, true);
  assert.equal((await probe({...spec,env:{...process.env,FAKE_MCP_BUSINESS_ERROR:"1"}})).ok,false);
  assert.equal(
    (await probe({ ...spec, required: ["absent"] })).code,
    "MISSING_TOOLS",
  );
  const failed = await probe({
    ...spec,
    env: {
      ...process.env,
      FAKE_MCP_FAIL: "1",
      TAPD_ACCESS_TOKEN: "secret-fixture",
    },
  });
  assert.equal(failed.ok, false);
  assert(!JSON.stringify(failed).includes("secret-fixture"));
  assert.equal(
    (
      await probe({
        ...spec,
        env: { ...process.env, FAKE_MCP_HANG: "1" },
        timeout: 150,
      })
    ).code,
    "TIMEOUT",
  );
});
test("same read capability works over Streamable HTTP, with pagination", async () => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    let m;
    try {
      m = JSON.parse(body);
    } catch {
      res.writeHead(405).end();
      return;
    }
    if (m.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (m.method === "initialize")
      result = {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    else if (m.method === "tools/list")
      result = m.params?.cursor
        ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
        : { tools: [], nextCursor: "next" };
    else result = { content: [{ type: "text", text: '{"ok":true}' }] };
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await probe({
      url: `http://127.0.0.1:${server.address().port}/mcp`,
      required: ["read"],
      probe: { tool: "read", args: {} },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tools, ["read"]);
    assert.equal(r.hostVerified, false);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("CLI refuses secret arguments without echoing them, and Node 22 rejects Discourse before prompt", () => {
  const r = spawnSync(
    process.execPath,
    [cli, "connect", "tapd", "--token", "secret-fixture"],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert(!r.stdout.includes("secret-fixture"));
  if (Number(process.versions.node.split(".")[0]) < 24) {
    const result = spawnSync(
      process.execPath,
      [cli, "connect", "discourse", "--host", "cursor", "--connection", "wise"],
      { encoding: "utf8", env: { ...process.env, WORKBRIDGE_HOME: temp() } },
    );
    assert.equal(JSON.parse(result.stdout).code, "NODE_VERSION");
  }
});

test("new development branch uses shared Git helpers and writes only generic state", async () => {
  const dir = temp(),
    state = temp(),
    prev = process.cwd(),
    old = process.env.WORKBRIDGE_HOME;
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "readme"), "x");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "init");
  process.chdir(dir);
  process.env.WORKBRIDGE_HOME = state;
  try {
    await start(ref, "main", "codex/example");
    assert.equal(git(dir, "branch", "--show-current"), "codex/example");
    assert.deepEqual(current().resource, ref);
    assert(!existsSync(join(dir, ".tapd")));
    assert(!existsSync(join(dir, ".git/tapd-context")));
    writeFileSync(join(dir, "dirty"), "x");
    await assert.rejects(start(ref, "main", "codex/another"), {
      code: "WORKTREE_NOT_CLEAN",
    });
    assert.equal(git(dir, "branch", "--show-current"), "codex/example");
  } finally {
    process.chdir(prev);
    if (old === undefined) delete process.env.WORKBRIDGE_HOME;
    else process.env.WORKBRIDGE_HOME = old;
  }
});
