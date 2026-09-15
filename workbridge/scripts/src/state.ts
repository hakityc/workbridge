import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ActionResult,
  BridgeError,
  ResourceRef,
  identifier,
  requireValue,
  resource,
} from "./contracts.js";
import { atomicPrivate, ensurePrivate, home, readPrivate } from "./storage.js";

export function resourceKey(r: ResourceRef): string {
  resource(r);
  return createHash("sha256")
    .update(JSON.stringify([r.provider, r.connection, r.space, r.kind, r.id]))
    .digest("hex");
}
function project(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}
function contextFile(): string {
  const branch = spawnSync(
    "git",
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { encoding: "utf8" },
  );
  requireValue(
    branch.status === 0,
    "NO_NAMED_BRANCH",
    "分支绑定需要 Git 仓库中的命名分支。",
  );
  const hash = createHash("sha256")
    .update(JSON.stringify([project(), branch.stdout.trim()]))
    .digest("hex");
  return join(home(), "contexts", hash + ".json");
}
export function bind(r: ResourceRef, replace = false): unknown {
  resource(r);
  const path = contextFile();
  if (existsSync(path)) {
    const old = readPrivate<{ resource: ResourceRef }>(path);
    requireValue(
      replace || resourceKey(old.resource) === resourceKey(r),
      "CONTEXT_CONFLICT",
      "已有不同绑定；明确确认后使用 --replace。",
    );
  }
  const value = { version: 1, resource: r, project: project() };
  atomicPrivate(path, value);
  return value;
}
export function current(): unknown {
  return readPrivate(contextFile());
}
export async function start(
  r: ResourceRef,
  base: string,
  branch: string,
): Promise<unknown> {
  resource(r);
  requireValue(
    base && branch && !base.startsWith("-") && !branch.startsWith("-"),
    "INVALID_BRANCH",
    "需要明确的基线和新分支名。",
  );
  // Reuse the existing Git implementation; no platform fields enter the new binding.
  const git = await import(
    new URL("../tapd-context/dist/git.js", import.meta.url).href
  );
  let original: string | undefined,
    root: string | undefined,
    switched = false;
  try {
    root = git.getRepoRoot(process.cwd());
    original = git.getCurrentBranch(root);
    git.assertCleanWorktree(root);
    git.assertBaseBranch(root, base);
    git.runGit(["check-ref-format", "--branch", branch], root);
    requireValue(
      !git.branchExists(root, branch),
      "BRANCH_EXISTS",
      "目标分支已存在，未切换。",
    );
    ensurePrivate(join(home(), "contexts"));
    const bindingPath = join(
      home(),
      "contexts",
      createHash("sha256")
        .update(JSON.stringify([root, branch]))
        .digest("hex") + ".json",
    );
    requireValue(
      !existsSync(bindingPath),
      "CONTEXT_CONFLICT",
      "目标分支已有本地绑定；请先核查，不覆盖。",
    );
    git.switchBranch(root, base);
    switched = true;
    git.createAndSwitchBranch(root, branch);
    return bind(r);
  } catch (e) {
    if (switched && root && original) git.tryRestoreBranch(root, original);
    if (e instanceof BridgeError) throw e;
    throw new BridgeError(
      typeof (e as any).code === "string" ? (e as any).code : "GIT_FAILED",
      "Git 操作未完成；未 pull、stash 或删除分支，请检查当前分支。",
    );
  }
}
export function migrate(connection: string): unknown {
  identifier(connection);
  const base = project();
  const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
    encoding: "utf8",
  });
  const branch = spawnSync(
    "git",
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { encoding: "utf8" },
  );
  requireValue(
    gitDir.status === 0 && branch.status === 0,
    "NO_NAMED_BRANCH",
    "迁移需要命名分支。",
  );
  const branchName = branch.stdout.trim();
  const hash = createHash("sha1").update(branchName).digest("hex");
  const modern = join(
    gitDir.stdout.trim(),
    "tapd-context",
    "branches",
    hash + ".json",
  );
  const legacy = join(base, ".tapd", "context.json");
  let source: any;
  try {
    if (existsSync(modern)) source = JSON.parse(readFileSync(modern, "utf8"));
    else if (existsSync(legacy))
      source = JSON.parse(readFileSync(legacy, "utf8")).branches?.[branchName]
        ?.work_item;
  } catch {
    throw new BridgeError("INVALID_LEGACY", "旧上下文损坏；未修改。");
  }
  requireValue(source, "NO_LEGACY_CONTEXT", "当前分支没有可迁移绑定。");
  const types: Record<string, string> = {
    Story: "requirement",
    Task: "task",
    Bug: "defect",
  };
  requireValue(
    types[source.entity_type] &&
      typeof source.id === "string" &&
      source.workspace_id,
    "INVALID_LEGACY",
    "旧绑定缺少类型、空间或字符串 ID。",
  );
  const r: ResourceRef = {
    provider: "tapd",
    connection,
    space: String(source.workspace_id),
    kind: types[source.entity_type],
    id: source.id,
  };
  // Validate all input files before any writes. Legacy files are never modified.
  const configPath = ["config.json", "project.json"]
    .map((n) => join(base, ".tapd", n))
    .find(existsSync);
  let settings: unknown;
  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      settings = {
        base_branch: raw.base_branch,
        profile: raw.profile,
        workflow: raw.workflow,
        effort: raw.effort,
      };
    } catch {
      throw new BridgeError("INVALID_LEGACY", "旧配置损坏；未修改。");
    }
  }
  let destination: string | undefined, migratedSettings: unknown;
  if (settings) {
    const dest = join(
      home(),
      "projects",
      createHash("sha256").update(base).digest("hex") + ".json",
    );
    const value = { version: 1, project: base, connection, settings };
    if (existsSync(dest))
      requireValue(
        JSON.stringify(readPrivate(dest)) === JSON.stringify(value),
        "CONFIG_CONFLICT",
        "新配置已存在且不同；未覆盖。",
      );
    else {
      destination = dest;
      migratedSettings = value;
    }
  }
  const result = bind(r);
  if (destination) atomicPrivate(destination, migratedSettings);
  return result;
}
export interface RunRecord {
  version: 1;
  id: string;
  draft?: string;
  results: ActionResult[];
}
export function saveRun(v: RunRecord): RunRecord {
  requireValue(
    v.version === 1 && Array.isArray(v.results),
    "INVALID_RUN",
    "运行记录无效。",
  );
  identifier(v.id);
  requireValue(
    Object.keys(v).every((k) =>
      ["version", "id", "draft", "results"].includes(k),
    ),
    "INVALID_RUN",
    "仅保存必要草案和结果。",
  );
  requireValue(
    v.draft === undefined ||
      (typeof v.draft === "string" && v.draft.length <= 10000),
    "INVALID_RUN",
    "草案不得超过 10000 字符。",
  );
  const seen = new Set<string>();
  for (const r of v.results) {
    requireValue(
      !seen.has(r.step) && typeof r.step === "string",
      "INVALID_RUN",
      "步骤 ID 缺失或重复。",
    );
    seen.add(r.step);
    requireValue(
      ["success", "failed", "unknown", "skipped"].includes(r.status) &&
        typeof r.verified === "boolean",
      "INVALID_RUN",
      "结果状态无效。",
    );
    requireValue(
      Object.keys(r).every((k) =>
        ["step", "status", "resource", "verified", "evidence"].includes(k),
      ),
      "INVALID_RUN",
      "结果包含未知字段。",
    );
    if (r.resource) resource(r.resource);
    requireValue(
      r.status !== "success" || r.verified,
      "INVALID_RUN",
      "成功步骤必须附带验证。",
    );
  }
  requireValue(
    !/"(?:token|api_key|password|authorization)"\s*:|Bearer\s+[A-Za-z0-9._-]+/i.test(
      JSON.stringify(v),
    ),
    "SECRET_IN_STATE",
    "状态中检测到凭据字段。",
  );
  const path = join(home(), "runs", v.id + ".json");
  if (existsSync(path)) {
    const old = readPrivate<RunRecord>(path);
    for (const r of old.results.filter((x) => x.status === "success"))
      requireValue(
        JSON.stringify(v.results.find((x) => x.step === r.step)) ===
          JSON.stringify(r),
        "COMPLETED_STEP_CHANGED",
        "已成功步骤不可重写或移除。",
      );
  }
  atomicPrivate(path, v);
  return v;
}
export function loadRun(id: string): RunRecord {
  return readPrivate(join(home(), "runs", identifier(id) + ".json"));
}
