import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { ConnectionProfile, Host, requireValue } from "./contracts.js";

export type Runner = (command: string, args: string[]) => string;
export const run: Runner = (command, args) => {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  requireValue(
    !r.error && r.status === 0,
    "HOST_COMMAND_FAILED",
    "宿主命令失败；未输出可能包含凭据的原始响应。",
  );
  return r.stdout;
};
function hostPath(host: Host, userHome: string): string {
  return host === "cursor"
    ? join(userHome, ".cursor", "mcp.json")
    : join(userHome, ".claude.json");
}
function readConfig(path: string): Record<string, any> {
  let p = path;
  while (p !== dirname(p)) {
    if (existsSync(p))
      requireValue(
        !lstatSync(p).isSymbolicLink(),
        "UNSAFE_HOST_PATH",
        "宿主配置路径包含符号链接。",
      );
    p = dirname(p);
  }
  if (!existsSync(path)) return {};
  let v;
  try {
    v = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    requireValue(
      false,
      "INVALID_HOST_CONFIG",
      "宿主配置不是有效 JSON；未覆盖。",
    );
  }
  requireValue(
    v && typeof v === "object" && !Array.isArray(v),
    "INVALID_HOST_CONFIG",
    "宿主配置无效。",
  );
  return v;
}
export function inspect(
  host: Host,
  server: string,
  runner: Runner = run,
  userHome = homedir(),
): unknown | undefined {
  if (host === "codex") {
    const entries = JSON.parse(runner("codex", ["mcp", "list", "--json"]));
    requireValue(
      Array.isArray(entries),
      "INVALID_HOST_CONFIG",
      "Codex 未返回服务列表。",
    );
    const e = entries.find((x: any) => x.name === server);
    return e
      ? JSON.parse(runner("codex", ["mcp", "get", server, "--json"]))
      : undefined;
  }
  return readConfig(hostPath(host, userHome)).mcpServers?.[server];
}
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
export function fingerprint(v: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(v)) || "null")
    .digest("hex");
}
export function registration(
  p: ConnectionProfile,
  cli: string,
):
  | { command: string; args: string[] }
  | { url: string; type: string; bearerEnv?: string } {
  if (p.transport === "stdio")
    return { command: process.execPath, args: [cli, "mcp-launch", p.name] };
  requireValue(p.url, "INVALID_CONNECTION", "缺少远程 URL。");
  requireValue(
    p.auth !== "bearer-env" || p.host === "codex",
    "UNSUPPORTED_AUTH",
    "此宿主适配器尚无已验证的安全 Bearer 引用，请使用 OAuth。",
  );
  return {
    url: p.url,
    type: "http",
    ...(p.bearerEnv ? { bearerEnv: p.bearerEnv } : {}),
  };
}
export function matchesRegistration(
  actual: unknown,
  p: ConnectionProfile,
  cli: string,
): boolean {
  if (!actual || typeof actual !== "object") return false;
  const config = (actual as any).transport || (actual as any),
    value = registration(p, cli);
  return "url" in value
    ? config.url === value.url &&
        (config.bearer_token_env_var || undefined) ===
          (value.bearerEnv || undefined)
    : config.command === value.command &&
        JSON.stringify(config.args) === JSON.stringify(value.args) &&
        Object.keys(config.env || {}).length === 0 &&
        (config.env_vars || []).length === 0 && !config.cwd;
}
export function applyHost(
  p: ConnectionProfile,
  cli: string,
  expected: unknown,
  runner: Runner = run,
  userHome = homedir(),
): string {
  requireValue(
    fingerprint(inspect(p.host, p.server, runner, userHome)) ===
      fingerprint(expected),
    "HOST_CONFIG_CHANGED",
    "宿主配置已变化，请重新检查。",
  );
  const value = registration(p, cli);
  if (p.host === "cursor") {
    const path = hostPath(p.host, userHome);
    const config = readConfig(path);
    config.mcpServers = {
      ...config.mcpServers,
      [p.server]: "url" in value ? { url: value.url } : value,
    };
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(tmp, path);
    } finally {
      rmSync(tmp, { force: true });
    }
  } else {
    const args =
      p.host === "codex"
        ? ["mcp", "add", p.server]
        : ["mcp", "add", "--scope", "user"];
    if ("url" in value) {
      if (p.host === "codex")
        args.push(
          "--url",
          value.url,
          ...(value.bearerEnv
            ? ["--bearer-token-env-var", value.bearerEnv]
            : []),
        );
      else args.push("--transport", "http", p.server, value.url);
    } else {
      if (p.host === "claude") args.push(p.server);
      args.push("--", value.command, ...value.args);
    }
    runner(p.host, args);
  }
  const actual = inspect(p.host, p.server, runner, userHome);
  requireValue(
    actual,
    "HOST_READBACK_FAILED",
    "宿主配置命令已返回，但配置回读失败；请运行 doctor。",
  );
  requireValue(
    matchesRegistration(actual, p, cli),
    "HOST_READBACK_FAILED",
    "宿主回读与计划不一致；请运行 doctor。",
  );
  return fingerprint(actual);
}
export function removeHost(
  p: ConnectionProfile,
  runner: Runner = run,
  userHome = homedir(),
): void {
  const actual = inspect(p.host, p.server, runner, userHome);
  if (actual === undefined) return;
  requireValue(
    p.hostFingerprint && fingerprint(actual) === p.hostFingerprint,
    "HOST_CONFLICT",
    "宿主配置与 WorkBridge 记录不一致，不移除。",
  );
  if (p.host === "cursor") {
    const path = hostPath(p.host, userHome),
      config = readConfig(path);
    delete config.mcpServers[p.server];
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(tmp, path);
    } finally {
      rmSync(tmp, { force: true });
    }
  } else
    runner(
      p.host,
      p.host === "codex"
        ? ["mcp", "remove", p.server]
        : ["mcp", "remove", "--scope", "user", p.server],
    );
  requireValue(
    inspect(p.host, p.server, runner, userHome) === undefined,
    "HOST_READBACK_FAILED",
    "移除后仍检测到服务配置。",
  );
}
export const reload = {
  codex:
    "完全退出并重新打开 Codex 应用/会话，再由 Agent 调用该服务的只读工具验证。",
  claude:
    "退出并重新启动 Claude Code，再用 /mcp 查看连接，并由 Agent 执行只读查询。",
  cursor:
    "在 MCP 设置中重新启用该服务；若未加载则重启 Cursor，再由 Agent 执行只读查询。",
};
