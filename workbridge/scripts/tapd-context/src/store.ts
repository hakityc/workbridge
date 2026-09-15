import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  fsyncSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getGitDir } from "./git.js";
import {
  CachedWorkItem,
  CliError,
  ContextStore,
  ContextSource,
  emptyContextStore,
  GitBranchBinding,
  ProjectConfig,
  WorkItemInput,
  validateContextStore,
  validateProjectConfig,
} from "./schema.js";

export const CONFIG_FILE = join(".tapd", "config.json");
export const LEGACY_PROJECT_FILE = join(".tapd", "project.json");
export const CONTEXT_FILE = join(".tapd", "context.json");
export const ACTIVE_CONTEXT_FILE = join(".tapd", "active-context.md");
export const GLOBAL_CONTEXT_HOME_ENV = "TAPD_CONTEXT_HOME";

function readJson(path: string, errorCode: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      throw cause;
    }
    throw new CliError(errorCode, `${path} 不是有效 JSON。`);
  }
}

export function readProject(repoRoot: string): ProjectConfig {
  const configPath = join(repoRoot, CONFIG_FILE);
  const legacyPath = join(repoRoot, LEGACY_PROJECT_FILE);
  try {
    return validateProjectConfig(readJson(configPath, "INVALID_CONFIG_FILE"));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    return validateProjectConfig(readJson(legacyPath, "INVALID_PROJECT_FILE"));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code !== "ENOENT") {
      if (error instanceof CliError && error.code === "INVALID_CONFIG_FILE") {
        throw new CliError("INVALID_PROJECT_FILE", ".tapd/project.json 配置无效。");
      }
      throw error;
    }
    throw new CliError(
      "PROJECT_NOT_INITIALIZED",
      "尚未初始化 .tapd/config.json，请先执行 tapd-context init。",
    );
  }
}

export function readContextStore(repoRoot: string): ContextStore {
  const path = join(repoRoot, CONTEXT_FILE);
  try {
    return validateContextStore(readJson(path, "INVALID_CONTEXT_FILE"));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return emptyContextStore();
    }
    throw error;
  }
}

export function writeJsonAtomic(path: string, value: unknown, errorCode: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeTextAtomic(tempPath, path, `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    throw new CliError(errorCode, `写入 ${path} 失败。`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function writeTextAtomic(tempPath: string, path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const file = openSync(tempPath, "w", 0o600);
  try {
    writeSync(file, content, 0, "utf8");
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  try {
    renameSync(tempPath, path);
  } catch (error) {
    throw error;
  }
}

export function writeProject(repoRoot: string, config: ProjectConfig): void {
  writeJsonAtomic(join(repoRoot, CONFIG_FILE), config, "CONFIG_WRITE_FAILED");
}

export function writeContextStore(repoRoot: string, store: ContextStore): void {
  writeJsonAtomic(join(repoRoot, CONTEXT_FILE), store, "CONTEXT_WRITE_FAILED");
}

export function branchHash(branch: string): string {
  return createHash("sha1").update(branch).digest("hex");
}

export function contextIdFor(item: WorkItemInput): string {
  return `tapd:${item.workspace_id || "unknown"}:${item.entity_type}:${item.id}`;
}

export function gitContextDir(repoRoot: string): string {
  return join(getGitDir(repoRoot), "tapd-context");
}

function gitBranchBindingPath(repoRoot: string, branch: string): string {
  return join(gitContextDir(repoRoot), "branches", `${branchHash(branch)}.json`);
}

function validateGitBranchBinding(value: unknown, path: string): GitBranchBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("INVALID_CONTEXT_FILE", `${path} 必须是 JSON 对象。`);
  }
  const binding = value as GitBranchBinding;
  if (
    binding.version !== 1 ||
    binding.provider !== "tapd" ||
    !binding.branch ||
    !binding.branch_hash ||
    !binding.context_id ||
    !binding.entity_type ||
    !binding.id ||
    !binding.source ||
    !binding.binding ||
    !binding.git ||
    !binding.created_at ||
    !binding.updated_at
  ) {
    throw new CliError("INVALID_CONTEXT_FILE", `${path} 结构不完整。`);
  }
  return binding;
}

export function makeGitBranchBinding(
  branch: string,
  item: WorkItemInput,
  source: ContextSource,
  method: "start" | "bind",
  baseBranch: string,
  sourceBranch: string,
  commit: string,
  createdAt?: string,
): GitBranchBinding {
  const now = createdAt || new Date().toISOString();
  return {
    version: 1,
    branch,
    branch_hash: branchHash(branch),
    context_id: contextIdFor(item),
    provider: "tapd",
    ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
    entity_type: item.entity_type,
    id: item.id,
    ...(item.short_id ? { short_id: item.short_id } : {}),
    source,
    binding: { method },
    git: {
      base_branch: baseBranch,
      source_branch: sourceBranch,
      created_from_commit: commit,
    },
    created_at: now,
    updated_at: now,
  };
}

export function readGitBranchBinding(
  repoRoot: string,
  branch: string,
): GitBranchBinding | null {
  const path = gitBranchBindingPath(repoRoot, branch);
  try {
    return validateGitBranchBinding(readJson(path, "INVALID_CONTEXT_FILE"), path);
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function writeGitBranchBinding(
  repoRoot: string,
  binding: GitBranchBinding,
): void {
  const dir = gitContextDir(repoRoot);
  writeJsonAtomic(join(dir, "version"), { version: 1 }, "CONTEXT_WRITE_FAILED");
  writeJsonAtomic(
    join(dir, "HEAD.json"),
    {
      version: 1,
      branch: binding.branch,
      branch_hash: binding.branch_hash,
      context_id: binding.context_id,
      updated_at: binding.updated_at,
    },
    "CONTEXT_WRITE_FAILED",
  );
  writeJsonAtomic(
    gitBranchBindingPath(repoRoot, binding.branch),
    binding,
    "CONTEXT_WRITE_FAILED",
  );
}

export function globalContextHome(): string {
  const configured = process.env[GLOBAL_CONTEXT_HOME_ENV];
  return configured && configured.trim()
    ? configured.trim()
    : join(homedir(), ".tapd-context");
}

export function cachedWorkItemFromInput(
  item: WorkItemInput,
  source: string,
): CachedWorkItem {
  return {
    version: 1,
    provider: "tapd",
    ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
    entity_type: item.entity_type,
    id: item.id,
    ...(item.short_id ? { short_id: item.short_id } : {}),
    ...(item.title ? { title: item.title } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.user_nick ? { user_nick: item.user_nick } : {}),
    last_mcp_sync_at: null,
    source,
    schema_version: 1,
  };
}

function cachePathFor(item: WorkItemInput | CachedWorkItem): string {
  const workspace = item.workspace_id || "unknown";
  return join(
    globalContextHome(),
    "cache",
    "tapd",
    workspace,
    item.entity_type,
    `${item.id}.json`,
  );
}

function corruptJson(path: string): void {
  const target = `${path}.corrupt.${Date.now()}`;
  try {
    renameSync(path, target);
  } catch {
    // Best effort. The resolver can continue without this cache entry.
  }
}

function readCacheJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return null;
    }
    corruptJson(path);
    return null;
  }
}

function validateCachedWorkItem(value: unknown): CachedWorkItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as CachedWorkItem;
  if (
    item.version !== 1 ||
    item.provider !== "tapd" ||
    !item.entity_type ||
    !item.id
  ) {
    return null;
  }
  return item;
}

export function writeCachedWorkItem(item: CachedWorkItem): void {
  writeJsonAtomic(cachePathFor(item), item, "CONTEXT_WRITE_FAILED");
}

export function readCachedWorkItem(
  workspaceId: string | undefined,
  entityType: WorkItemInput["entity_type"],
  id: string,
): CachedWorkItem | null {
  const value = readCacheJson(
    cachePathFor({
      source: "tapd",
      workspace_id: workspaceId || "unknown",
      entity_type: entityType,
      id,
    }),
  );
  return validateCachedWorkItem(value);
}

export function findCachedWorkItemsById(id: string): CachedWorkItem[] {
  const root = join(globalContextHome(), "cache", "tapd");
  if (!existsSync(root)) {
    return [];
  }
  const matches: CachedWorkItem[] = [];
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) {
      continue;
    }
    for (const entityType of ["Story", "Task", "Bug"] as const) {
      const path = join(root, workspace.name, entityType, `${id}.json`);
      const item = validateCachedWorkItem(readCacheJson(path));
      if (item) {
        matches.push(item);
      }
    }
  }
  return matches;
}

export function writeActiveContext(repoRoot: string, content: string): void {
  const path = join(repoRoot, ACTIVE_CONTEXT_FILE);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeTextAtomic(tempPath, path, content);
  } catch (error) {
    throw new CliError("CONTEXT_WRITE_FAILED", `写入 ${ACTIVE_CONTEXT_FILE} 失败。`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface CredentialsStatus {
  path: string;
  exists: boolean;
  secure: boolean;
  message: string;
}

export function getCredentialsStatus(): CredentialsStatus {
  const path = join(globalContextHome(), "credentials.json");
  try {
    const stat = statSync(path);
    const secure = process.platform === "win32" || (stat.mode & 0o077) === 0;
    return {
      path,
      exists: true,
      secure,
      message: secure
        ? "credentials.json 权限安全。"
        : "credentials.json 权限过宽；请 chmod 600 后再使用。",
    };
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return {
        path,
        exists: false,
        secure: true,
        message: "未发现 tapd-context credentials.json；将优先使用 MCP 或环境认证。",
      };
    }
    return {
      path,
      exists: false,
      secure: false,
      message: "无法检查 credentials.json 权限。",
    };
  }
}

export function logoutCredentials(): boolean {
  const path = join(globalContextHome(), "credentials.json");
  try {
    rmSync(path);
    return true;
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return false;
    }
    throw new CliError("CONTEXT_WRITE_FAILED", "删除 credentials.json 失败。");
  }
}

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // chmod can be unsupported on some filesystems; the credentials check still gates reads.
  }
}
