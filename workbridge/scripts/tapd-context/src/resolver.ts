import { parseTapdBranchName } from "./branch-name.js";
import { getCurrentBranch, getHeadCommit } from "./git.js";
import {
  CachedWorkItem,
  CliError,
  ContextCandidate,
  ContextSource,
  EntityType,
  GitBranchBinding,
  ProjectConfig,
  WorkItemInput,
} from "./schema.js";
import {
  cachedWorkItemFromInput,
  contextIdFor,
  findCachedWorkItemsById,
  makeGitBranchBinding,
  readCachedWorkItem,
  readContextStore,
  readGitBranchBinding,
  readProject,
  writeCachedWorkItem,
  writeGitBranchBinding,
} from "./store.js";

export interface ResolveResult {
  branch: string;
  candidate: ContextCandidate;
  migrated_legacy: boolean;
}

function maybeProject(repoRoot: string): ProjectConfig | null {
  try {
    return readProject(repoRoot);
  } catch (error) {
    if (error instanceof CliError && error.code === "PROJECT_NOT_INITIALIZED") {
      return null;
    }
    throw error;
  }
}

function itemFromCache(cache: CachedWorkItem): WorkItemInput {
  return {
    source: "tapd",
    entity_type: cache.entity_type,
    id: cache.id,
    ...(cache.short_id ? { short_id: cache.short_id } : {}),
    ...(cache.title ? { title: cache.title } : {}),
    ...(cache.url ? { url: cache.url } : {}),
    ...(cache.user_nick ? { user_nick: cache.user_nick } : {}),
    ...(cache.workspace_id ? { workspace_id: cache.workspace_id } : {}),
  };
}

function mergeCache(item: WorkItemInput, cache: CachedWorkItem | null): WorkItemInput {
  if (!cache) {
    return item;
  }
  return {
    ...itemFromCache(cache),
    ...item,
    title: item.title || cache.title,
    url: item.url || cache.url,
    user_nick: item.user_nick || cache.user_nick,
    short_id: item.short_id || cache.short_id,
    workspace_id: item.workspace_id || cache.workspace_id,
  };
}

function candidateFromItem(
  branch: string,
  item: WorkItemInput,
  source: ContextSource,
  confidence: number,
  reason: string,
  extras: Partial<ContextCandidate> = {},
): ContextCandidate {
  return {
    provider: "tapd",
    ...(item.workspace_id ? { workspaceId: item.workspace_id } : {}),
    entityType: item.entity_type,
    id: item.id,
    ...(item.short_id ? { shortId: item.short_id } : {}),
    contextId: contextIdFor(item),
    source,
    confidence,
    reason,
    branch,
    workItem: item,
    status: {
      local_phase: "initialized",
      last_synced_at: null,
    },
    ...extras,
  };
}

export function candidateFromExplicitInput(
  branch: string,
  item: WorkItemInput,
  source: "explicit-url" | "explicit-json",
  method: "start" | "bind",
  baseBranch: string,
  sourceBranch: string,
  commit: string,
): ContextCandidate {
  return candidateFromItem(
    branch,
    item,
    source,
    100,
    source === "explicit-url"
      ? "本轮显式 TAPD URL。"
      : "本轮显式 TAPD Context JSON。",
    {
      binding: { method },
      git: {
        base_branch: baseBranch,
        source_branch: sourceBranch,
        created_from_commit: commit,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  );
}

function candidateFromBinding(
  branch: string,
  binding: GitBranchBinding,
): ContextCandidate {
  const item: WorkItemInput = {
    source: "tapd",
    entity_type: binding.entity_type,
    id: binding.id,
    ...(binding.short_id ? { short_id: binding.short_id } : {}),
    ...(binding.workspace_id ? { workspace_id: binding.workspace_id } : {}),
  };
  const cache = readCachedWorkItem(item.workspace_id, item.entity_type, item.id);
  return candidateFromItem(
    branch,
    mergeCache(item, cache),
    "git-dir-binding",
    90,
    "当前分支在 $GIT_DIR/tapd-context 中有本机绑定。",
    {
      binding: binding.binding,
      git: binding.git,
      created_at: binding.created_at,
      updated_at: binding.updated_at,
    },
  );
}

function candidateFromBranchName(
  repoRoot: string,
  branch: string,
  project: ProjectConfig | null,
): ContextCandidate | null {
  const parsed = parseTapdBranchName(branch);
  if (!parsed) {
    return null;
  }

  if (parsed.entity_type) {
    const item: WorkItemInput = {
      source: "tapd",
      entity_type: parsed.entity_type,
      id: parsed.id,
      ...(project?.workspace_id ? { workspace_id: project.workspace_id } : {}),
    };
    const cache = readCachedWorkItem(item.workspace_id, item.entity_type, item.id);
    const confidence = cache ? 75 : 50;
    return candidateFromItem(
      branch,
      mergeCache(item, cache),
      "branch-name",
      confidence,
      cache
        ? "分支名包含 TAPD 身份，且本机存在缓存。"
        : "分支名包含 TAPD 身份；未联网补全前仅为低置信度上下文。",
      {
        git: project
          ? {
              base_branch: project.base_branch,
              source_branch: branch,
              created_from_commit: getHeadCommit(repoRoot),
            }
          : undefined,
        warnings: cache ? undefined : ["BRANCH_NAME_ONLY_CONTEXT"],
      },
    );
  }

  const cached = findCachedWorkItemsById(parsed.id);
  if (cached.length === 1) {
    return candidateFromItem(
      branch,
      itemFromCache(cached[0]),
      "local-cache",
      75,
      "分支名简写匹配到唯一的本机 TAPD 缓存。",
      {
        git: project
          ? {
              base_branch: project.base_branch,
              source_branch: branch,
              created_from_commit: getHeadCommit(repoRoot),
            }
          : undefined,
      },
    );
  }

  const fallbackType: EntityType = "Story";
  const item: WorkItemInput = {
    source: "tapd",
    entity_type: fallbackType,
    id: parsed.id,
    ...(project?.workspace_id ? { workspace_id: project.workspace_id } : {}),
  };
  return candidateFromItem(
    branch,
    item,
    "branch-name",
    40,
    "分支名使用 tapd-<id> 简写，缺少类型信息；默认按 Story 低置信度恢复。",
    {
      git: project
        ? {
            base_branch: project.base_branch,
            source_branch: branch,
            created_from_commit: getHeadCommit(repoRoot),
          }
        : undefined,
      warnings: ["BRANCH_NAME_SHORTHAND_LOW_CONFIDENCE"],
    },
  );
}

function candidateFromLegacy(repoRoot: string, branch: string): ContextCandidate | null {
  const store = readContextStore(repoRoot);
  const context = store.branches[branch];
  if (!context) {
    return null;
  }
  return candidateFromItem(
    branch,
    context.work_item,
    "legacy-context",
    60,
    "读取到旧版 .tapd/context.json 当前分支绑定，并迁移到新本机存储。",
    {
      binding: context.binding,
      git: context.git,
      created_at: context.created_at,
      updated_at: context.updated_at,
      status: context.status,
      warnings: ["LEGACY_CONTEXT_MIGRATED"],
    },
  );
}

export function persistCandidate(
  repoRoot: string,
  candidate: ContextCandidate,
  method: "start" | "bind" = candidate.binding?.method || "bind",
): void {
  const git = candidate.git || {
    base_branch: candidate.branch,
    source_branch: candidate.branch,
    created_from_commit: getHeadCommit(repoRoot),
  };
  const binding = makeGitBranchBinding(
    candidate.branch,
    candidate.workItem,
    candidate.source,
    method,
    git.base_branch,
    git.source_branch,
    git.created_from_commit,
    candidate.created_at,
  );
  writeGitBranchBinding(repoRoot, binding);
  writeCachedWorkItem(cachedWorkItemFromInput(candidate.workItem, candidate.source));
}

export function resolveCurrent(repoRoot: string): ResolveResult {
  const branch = getCurrentBranch(repoRoot);
  const binding = readGitBranchBinding(repoRoot, branch);
  if (binding) {
    return {
      branch,
      candidate: candidateFromBinding(branch, binding),
      migrated_legacy: false,
    };
  }

  const project = maybeProject(repoRoot);
  const branchCandidate = candidateFromBranchName(repoRoot, branch, project);
  if (branchCandidate) {
    persistCandidate(repoRoot, branchCandidate, "bind");
    return { branch, candidate: branchCandidate, migrated_legacy: false };
  }

  const legacyCandidate = candidateFromLegacy(repoRoot, branch);
  if (legacyCandidate) {
    persistCandidate(repoRoot, legacyCandidate, legacyCandidate.binding?.method || "bind");
    return { branch, candidate: legacyCandidate, migrated_legacy: true };
  }

  throw new CliError("CONTEXT_NOT_FOUND", "当前分支没有 TAPD 上下文绑定。", {
    branch,
    resolver_chain: [
      "git-dir-binding",
      "branch-name",
      "local-cache",
      "legacy-context",
    ],
  });
}
