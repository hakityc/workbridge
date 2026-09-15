import { BranchContext, ContextCandidate } from "./schema.js";

export function publicContext(context: BranchContext): Record<string, unknown> {
  return {
    work_item: {
      source: context.work_item.source,
      entity_type: context.work_item.entity_type,
      id: context.work_item.id,
      ...(context.work_item.short_id ? { short_id: context.work_item.short_id } : {}),
      ...(context.work_item.title ? { title: context.work_item.title } : {}),
      ...(context.work_item.url ? { url: context.work_item.url } : {}),
      ...(context.work_item.workspace_id
        ? { workspace_id: context.work_item.workspace_id }
        : {}),
    },
    assignee: {
      display_name: context.assignee.display_name,
    },
    binding: context.binding,
    git: {
      base_branch: context.git.base_branch,
      source_branch: context.git.source_branch,
      created_from_commit: context.git.created_from_commit,
    },
    status: context.status,
    created_at: context.created_at,
    updated_at: context.updated_at,
  };
}

export function currentJson(branch: string, context: BranchContext): Record<string, unknown> {
  return {
    ok: true,
    branch,
    context: publicContext(context),
  };
}

export function currentMarkdown(branch: string, context: BranchContext): string {
  const item = context.work_item;
  const lines = [
    `当前分支：${branch}`,
    `工作项：${item.entity_type} ${item.id}`,
  ];
  if (item.title) {
    lines.push(`标题：${item.title}`);
  }
  if (item.url) {
    lines.push(`链接：${item.url}`);
  }
  if (item.workspace_id) {
    lines.push(`项目：${item.workspace_id}`);
  }
  lines.push(`负责人：${context.assignee.display_name || "未提供"}`);
  lines.push(`绑定方式：${context.binding.method}`);
  lines.push(`本地阶段：${context.status.local_phase}`);
  lines.push(`base 分支：${context.git.base_branch}`);
  return lines.join("\n");
}

export function candidatePublicContext(
  candidate: ContextCandidate,
): Record<string, unknown> {
  const item = candidate.workItem;
  return {
    work_item: {
      source: item.source,
      entity_type: item.entity_type,
      id: item.id,
      ...(item.short_id ? { short_id: item.short_id } : {}),
      ...(item.title ? { title: item.title } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
    },
    assignee: {
      display_name: item.user_nick || "",
    },
    ...(candidate.binding ? { binding: candidate.binding } : {}),
    ...(candidate.git ? { git: candidate.git } : {}),
    status: candidate.status || {
      local_phase: "initialized",
      last_synced_at: null,
    },
    source: candidate.source,
    confidence: candidate.confidence,
    reason: candidate.reason,
    context_id: candidate.contextId,
    ...(candidate.created_at ? { created_at: candidate.created_at } : {}),
    ...(candidate.updated_at ? { updated_at: candidate.updated_at } : {}),
    ...(candidate.warnings?.length ? { warnings: candidate.warnings } : {}),
  };
}

export function currentCandidateJson(
  branch: string,
  candidate: ContextCandidate,
  migratedLegacy = false,
): Record<string, unknown> {
  return {
    ok: true,
    branch,
    context: candidatePublicContext(candidate),
    ...(migratedLegacy
      ? {
          migration: {
            from: ".tapd/context.json",
            to: "$GIT_DIR/tapd-context",
            note: "Detected legacy .tapd/context.json and migrated current branch binding to local Git dir storage.",
          },
        }
      : {}),
  };
}

export function currentCandidateMarkdown(candidate: ContextCandidate): string {
  const item = candidate.workItem;
  const lines = [
    `当前分支：${candidate.branch}`,
    `工作项：${item.entity_type} ${item.id}`,
  ];
  if (item.title) {
    lines.push(`标题：${item.title}`);
  }
  if (item.url) {
    lines.push(`链接：${item.url}`);
  }
  if (item.workspace_id) {
    lines.push(`项目：${item.workspace_id}`);
  }
  if (item.user_nick) {
    lines.push(`负责人：${item.user_nick}`);
  }
  if (candidate.binding?.method) {
    lines.push(`绑定方式：${candidate.binding.method}`);
  }
  lines.push(`来源：${candidate.source}`);
  lines.push(`置信度：${candidate.confidence}`);
  lines.push(`本地阶段：${candidate.status?.local_phase || "initialized"}`);
  if (candidate.git?.base_branch) {
    lines.push(`base 分支：${candidate.git.base_branch}`);
  }
  if (candidate.warnings?.length) {
    lines.push(`提示：${candidate.warnings.join(", ")}`);
  }
  return lines.join("\n");
}

function safeInline(value: string | undefined): string {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function yamlValue(value: string | number): string {
  return String(value).replace(/\n/g, " ");
}

export function renderActiveContext(candidate: ContextCandidate): string {
  const item = candidate.workItem;
  const generatedAt = new Date().toISOString();
  const title = safeInline(item.title) || "未补全";
  const url = safeInline(item.url) || "未提供";
  const summary = "本文件是 tapd-context 生成的 Agent 可读产物，不是 TAPD 事实源。需要最新需求详情时，请通过 MCP 刷新。";
  return `<!-- tapd-context
version: 1
branch: ${yamlValue(candidate.branch)}
context_id: ${yamlValue(candidate.contextId)}
provider: tapd
workspace_id: ${yamlValue(item.workspace_id || "unknown")}
entity_type: ${yamlValue(item.entity_type)}
id: ${yamlValue(item.id)}
source: ${yamlValue(candidate.source)}
confidence: ${yamlValue(candidate.confidence)}
generated_at: ${yamlValue(generatedAt)}
refresh: tapd-context sync --current-branch
stale_policy: do-not-use-if-current-branch-mismatch
-->

# TAPD Active Context

> If this file is stale or its branch does not match the current Git branch, do not use it.
> Run \`tapd-context sync --current-branch\` or ask the user to run \`/tapd 继续\`.

## Identity

- Provider: TAPD
- Workspace: ${item.workspace_id || "unknown"}
- Type: ${item.entity_type}
- ID: ${item.id}
- URL: ${url}
- Title: ${title}
- Branch: ${candidate.branch}
- Source: ${candidate.source}
- Confidence: ${candidate.confidence}
- Generated At: ${generatedAt}

## Summary

${summary}

## Current Phase

${candidate.status?.local_phase || "initialized"}

## Suggested Next Actions

1. 如需完整需求内容，先通过 MCP 读取 TAPD 工作项。
2. 继续开发前确认当前 Git 分支与上方 Branch 一致。
3. 写 TAPD 评论、状态或工时时先刷新，并保持 dry-run + confirm。

## Safety

- This file is generated from TAPD context.
- It may be stale.
- Before writing TAPD comments, status, or worklog, refresh from TAPD first.
`;
}
