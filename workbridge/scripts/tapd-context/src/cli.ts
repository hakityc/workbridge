#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildBranchName } from "./branch-name.js";
import {
  candidatePublicContext,
  currentCandidateJson,
  currentCandidateMarkdown,
  renderActiveContext,
} from "./format.js";
import {
  assertBaseBranch,
  assertCleanWorktree,
  branchExists,
  createAndSwitchBranch,
  detectBaseCandidates,
  getCurrentBranch,
  getGitCommonDir,
  getGitDir,
  getGitPath,
  getHeadCommit,
  getRepoRoot,
  isPathIgnored,
  switchBranch,
  tryRestoreBranch,
} from "./git.js";
import { candidateFromExplicitInput, persistCandidate, resolveCurrent } from "./resolver.js";
import {
  CliError,
  defaultProjectConfig,
  ProjectConfig,
  TEAM_PROFILES,
  TeamProfile,
  validateTeamPolicy,
  WorkItemInput,
} from "./schema.js";
import {
  FLOW_SPEC_FILE,
  initializeFlowSpec,
  readAndValidateFlowSpec,
  renderFlowRequirement,
} from "./spec.js";
import {
  ACTIVE_CONTEXT_FILE,
  CONFIG_FILE,
  getCredentialsStatus,
  LEGACY_PROJECT_FILE,
  readContextStore,
  readGitBranchBinding,
  readProject,
  logoutCredentials,
  writeActiveContext,
  writeProject,
} from "./store.js";
import { parseInput } from "./tapd-url.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}

const GITIGNORE_SUGGESTION = [
  ".tapd/config.json",
  ".tapd/project.json",
  ".tapd/context.json",
  ".tapd/active-context.md",
  ".tapd/logs/",
];
const TEAM_POLICY_FILE = join(".tapd", "team.json");

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (["force", "current-branch", "silent", "on-checkout"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError("INVALID_ARGUMENT", `参数 --${key} 缺少值。`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, positionals, options };
}

function optionString(options: ParsedArgs["options"], key: string): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return [
    "tapd-context init --base <branch> [--workspace <id>] [--user <nick>] [--profile <profile>] [--force]",
    "tapd-context configure [--user <nick>] [--profile <profile>] [--base <branch>] [--workspace <id>]",
    "tapd-context start --input <context-json-or-url> [--slug <slug>]",
    "tapd-context bind --input <context-json-or-url> [--force]",
    "tapd-context current [--format json|markdown]",
    "tapd-context status",
    "tapd-context sync --current-branch [--silent]",
    "tapd-context refresh",
    "tapd-context doctor",
    "tapd-context spec init --spec-id <id> --title <title> --workspace <id> --document <path> --prototype <path|path> --in-scope <item|item> --acceptance <item|item> [--out-of-scope <item|item>] [--force]",
    "tapd-context spec validate",
    "tapd-context spec status",
    "tapd-context spec render",
    "tapd-context hook install|uninstall|status",
    "tapd-context logout",
    "tapd-context detect-base",
  ].join("\n");
}

function optionList(options: ParsedArgs["options"], key: string): string[] {
  return optionString(options, key)
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function optionProfile(options: ParsedArgs["options"]): TeamProfile | undefined {
  const profile = optionString(options, "profile");
  if (!profile) {
    return undefined;
  }
  if (!TEAM_PROFILES.includes(profile as TeamProfile)) {
    throw new CliError(
      "INVALID_ARGUMENT",
      `profile 必须是以下值之一：${TEAM_PROFILES.join(", ")}。`,
    );
  }
  return profile as TeamProfile;
}

function uniqueBranchName(repoRoot: string, desired: string): string {
  if (!branchExists(repoRoot, desired)) {
    return desired;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${desired}-${suffix}`;
    if (!branchExists(repoRoot, candidate)) {
      return candidate;
    }
  }
  throw new CliError("BRANCH_CREATE_FAILED", "无法生成可用的新分支名。");
}

function init(repoRoot: string, args: ParsedArgs): void {
  const user = optionString(args.options, "user");
  const base = optionString(args.options, "base");
  const workspace = optionString(args.options, "workspace");
  const profile = optionProfile(args.options);
  if (!base) {
    throw new CliError(
      "INVALID_ARGUMENT",
      "init 必须显式提供已确认的 --base；--workspace 和 --user 可选。",
      { candidates: detectBaseCandidates(repoRoot) },
    );
  }
  assertBaseBranch(repoRoot, base);

  const configPath = join(repoRoot, CONFIG_FILE);
  const legacyPath = join(repoRoot, LEGACY_PROJECT_FILE);
  if (
    (existsSync(configPath) || existsSync(legacyPath)) &&
    args.options.force !== true
  ) {
    throw new CliError(
      "PROJECT_ALREADY_INITIALIZED",
      "TAPD 项目配置已存在；如确认迁移或覆盖请传 --force。",
    );
  }

  writeProject(repoRoot, defaultProjectConfig(base, workspace, user, profile));
  printJson({
    ok: true,
    action: "init",
    config_file: CONFIG_FILE,
    base_branch: base,
    ...(workspace ? { workspace_id: workspace } : {}),
    ...(user ? { user_nick: user } : {}),
    ...(profile ? { profile } : {}),
    gitignore_suggestion: GITIGNORE_SUGGESTION,
  });
}

function configure(repoRoot: string, args: ParsedArgs): void {
  const project = readProject(repoRoot);
  const user = optionString(args.options, "user");
  const base = optionString(args.options, "base");
  const workspace = optionString(args.options, "workspace");
  const profile = optionProfile(args.options);
  if (!user && !base && !workspace && !profile) {
    throw new CliError(
      "INVALID_ARGUMENT",
      "configure 至少需要 --user、--profile、--base 或 --workspace 中的一项。",
    );
  }
  if (base) {
    assertBaseBranch(repoRoot, base);
    project.base_branch = base;
  }
  if (workspace) {
    project.workspace_id = workspace;
  }
  if (user) {
    project.user_nick = user;
  }
  if (profile) {
    project.profile = profile;
  }
  writeProject(repoRoot, project);
  printJson({
    ok: true,
    action: "configure",
    config_file: CONFIG_FILE,
    base_branch: project.base_branch,
    ...(project.workspace_id ? { workspace_id: project.workspace_id } : {}),
    ...(project.user_nick ? { user_nick: project.user_nick } : {}),
    ...(project.profile ? { profile: project.profile } : {}),
    migrated_from_legacy: existsSync(join(repoRoot, LEGACY_PROJECT_FILE)),
    gitignore_suggestion: GITIGNORE_SUGGESTION,
  });
}

function detectBase(repoRoot: string): void {
  printJson({
    ok: true,
    action: "detect-base",
    candidates: detectBaseCandidates(repoRoot),
  });
}

function applyProjectWorkspace(project: ProjectConfig, item: WorkItemInput): void {
  if (project.workspace_id && item.workspace_id) {
    if (project.workspace_id !== item.workspace_id) {
      throw new CliError(
        "WORKSPACE_MISMATCH",
        "输入工作项与项目配置属于不同 TAPD workspace。",
        {
          configured_workspace_id: project.workspace_id,
          input_workspace_id: item.workspace_id,
        },
      );
    }
    return;
  }
  if (!item.workspace_id && project.workspace_id) {
    item.workspace_id = project.workspace_id;
  }
}

function explicitSource(input: string): "explicit-url" | "explicit-json" {
  return /^https?:\/\//i.test(input.trim()) ? "explicit-url" : "explicit-json";
}

function persistAndRenderCurrent(
  repoRoot: string,
  candidate: ReturnType<typeof candidateFromExplicitInput>,
  method: "start" | "bind",
): void {
  persistCandidate(repoRoot, candidate, method);
  writeActiveContext(repoRoot, renderActiveContext(candidate));
}

function start(repoRoot: string, args: ParsedArgs): void {
  const originalBranch = getCurrentBranch(repoRoot);
  const input = optionString(args.options, "input");
  if (!input) {
    throw new CliError("INVALID_ARGUMENT", "start 必须提供 --input。");
  }
  const item = parseInput(input);
  let project: ProjectConfig;
  try {
    project = readProject(repoRoot);
  } catch (error) {
    if (error instanceof CliError && error.code === "PROJECT_NOT_INITIALIZED") {
      throw new CliError(error.code, error.message, {
        candidates: detectBaseCandidates(repoRoot),
        ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
      });
    }
    throw error;
  }
  applyProjectWorkspace(project, item);

  assertCleanWorktree(repoRoot);
  assertBaseBranch(repoRoot, project.base_branch);

  const desired = buildBranchName(
    project,
    item,
    optionString(args.options, "slug") || undefined,
    new Date(),
  );
  const newBranch = uniqueBranchName(repoRoot, desired);
  let createdFromCommit = "";

  try {
    switchBranch(repoRoot, project.base_branch);
    createdFromCommit = getHeadCommit(repoRoot);
    createAndSwitchBranch(repoRoot, newBranch);
  } catch (error) {
    const restore = tryRestoreBranch(repoRoot, originalBranch);
    if (!restore.restored) {
      throw new CliError(
        "RESTORE_FAILED",
        "创建分支失败，且无法自动恢复原分支。",
        {
          original_branch: originalBranch,
          attempted_branch: newBranch,
          original_error: error instanceof Error ? error.message : String(error),
          restore_error: restore.error,
          manual_recovery: [`git switch ${originalBranch}`, "git status"],
        },
      );
    }
    throw new CliError("BRANCH_CREATE_FAILED", "从 base 分支创建业务分支失败。", {
      original_branch: originalBranch,
      attempted_branch: newBranch,
      cause: error instanceof Error ? error.message : String(error),
      restored: true,
    });
  }

  const candidate = candidateFromExplicitInput(
    newBranch,
    item,
    explicitSource(input),
    "start",
    project.base_branch,
    project.base_branch,
    createdFromCommit,
  );

  try {
    persistAndRenderCurrent(repoRoot, candidate, "start");
  } catch (error) {
    const restore = tryRestoreBranch(repoRoot, originalBranch);
    if (!restore.restored) {
      throw new CliError(
        "RESTORE_FAILED",
        "上下文写入失败，且无法自动恢复原分支。",
        {
          original_branch: originalBranch,
          created_branch: newBranch,
          original_error: error instanceof Error ? error.message : String(error),
          restore_error: restore.error,
          manual_recovery: [
            `git switch ${originalBranch}`,
            "git status",
            `git branch -d ${newBranch}`,
          ],
        },
      );
    }
    throw new CliError("CONTEXT_WRITE_FAILED", "上下文写入失败，已恢复原分支。", {
      original_branch: originalBranch,
      created_branch: newBranch,
      restored: true,
      manual_cleanup: `git branch -d ${newBranch}`,
    });
  }

  printJson({
    ok: true,
    action: "start",
    branch: newBranch,
    context: candidatePublicContext(candidate),
    based_on: {
      branch: project.base_branch,
      commit: createdFromCommit,
      note: "新分支基于本地 base_branch 当前 HEAD 创建；如需远端最新内容，请先手动更新 base 分支。",
    },
    storage: {
      binding: "$GIT_DIR/tapd-context",
      cache: "~/.tapd-context/cache",
      active_context: ACTIVE_CONTEXT_FILE,
    },
    gitignore_suggestion: GITIGNORE_SUGGESTION,
  });
}

function bind(repoRoot: string, args: ParsedArgs): void {
  const project = readProject(repoRoot);
  const branch = getCurrentBranch(repoRoot);
  const input = optionString(args.options, "input");
  if (!input) {
    throw new CliError("INVALID_ARGUMENT", "bind 必须提供 --input。");
  }
  const item = parseInput(input);
  applyProjectWorkspace(project, item);
  const existing = readGitBranchBinding(repoRoot, branch);
  const legacy = existing ? undefined : readContextStore(repoRoot).branches[branch];
  if ((existing || legacy) && args.options.force !== true) {
    throw new CliError(
      "CONTEXT_ALREADY_BOUND",
      "当前分支已有上下文绑定；如确认覆盖请传 --force。",
      {
        branch,
        existing_work_item: {
          entity_type: existing?.entity_type || legacy?.work_item.entity_type,
          id: existing?.id || legacy?.work_item.id,
          title: legacy?.work_item.title,
        },
        source: existing ? "$GIT_DIR/tapd-context" : ".tapd/context.json",
      },
    );
  }

  const candidate = candidateFromExplicitInput(
    branch,
    item,
    explicitSource(input),
    "bind",
    project.base_branch,
    branch,
    getHeadCommit(repoRoot),
  );
  persistAndRenderCurrent(repoRoot, candidate, "bind");
  printJson({
    ok: true,
    action: "bind",
    branch,
    context: candidatePublicContext(candidate),
    storage: {
      binding: "$GIT_DIR/tapd-context",
      cache: "~/.tapd-context/cache",
      active_context: ACTIVE_CONTEXT_FILE,
    },
    gitignore_suggestion: GITIGNORE_SUGGESTION,
  });
}

function current(repoRoot: string, args: ParsedArgs): void {
  const resolved = resolveCurrent(repoRoot);
  writeActiveContext(repoRoot, renderActiveContext(resolved.candidate));
  const format = optionString(args.options, "format") || "json";
  if (format === "markdown") {
    process.stdout.write(`${currentCandidateMarkdown(resolved.candidate)}\n`);
    return;
  }
  if (format !== "json") {
    throw new CliError("INVALID_ARGUMENT", "--format 仅支持 json 或 markdown。");
  }
  printJson(
    currentCandidateJson(
      resolved.branch,
      resolved.candidate,
      resolved.migrated_legacy,
    ),
  );
}

function sync(repoRoot: string, args: ParsedArgs): void {
  if (args.options["current-branch"] !== true && args.command === "sync") {
    throw new CliError("INVALID_ARGUMENT", "sync 第一版仅支持 --current-branch。");
  }
  const resolved = resolveCurrent(repoRoot);
  writeActiveContext(repoRoot, renderActiveContext(resolved.candidate));
  if (args.options.silent === true) {
    return;
  }
  printJson({
    ...currentCandidateJson(
      resolved.branch,
      resolved.candidate,
      resolved.migrated_legacy,
    ),
    action: args.command === "refresh" ? "refresh" : "sync",
    active_context: ACTIVE_CONTEXT_FILE,
    offline_fallback: resolved.candidate.confidence < 90,
  });
}

function doctor(repoRoot: string): void {
  const credentials = getCredentialsStatus();
  let currentResult: Record<string, unknown>;
  try {
    const resolved = resolveCurrent(repoRoot);
    currentResult = {
      ok: true,
      branch: resolved.branch,
      source: resolved.candidate.source,
      confidence: resolved.candidate.confidence,
      context_id: resolved.candidate.contextId,
    };
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError("UNEXPECTED_ERROR", String(error));
    currentResult = {
      ok: false,
      error: {
        code: cliError.code,
        message: cliError.message,
      },
    };
  }
  printJson({
    ok: true,
    action: "doctor",
    git: {
      repo_root: repoRoot,
      git_dir: getGitDir(repoRoot),
      git_common_dir: getGitCommonDir(repoRoot),
    },
    project_config: {
      path: CONFIG_FILE,
      exists: existsSync(join(repoRoot, CONFIG_FILE)),
    },
    team_policy: teamPolicyStatus(repoRoot),
    flow_spec: flowSpecStatus(repoRoot),
    active_context: {
      ...activeContextStatus(repoRoot),
      recommendation: "请确保 .tapd/active-context.md 已加入 .gitignore。",
    },
    credentials,
    hook: hookStatus(repoRoot),
    current: currentResult,
  });
}

function flowSpecStatus(repoRoot: string): Record<string, unknown> {
  if (!existsSync(join(repoRoot, FLOW_SPEC_FILE))) {
    return { path: FLOW_SPEC_FILE, exists: false };
  }
  try {
    const result = readAndValidateFlowSpec(repoRoot);
    return {
      path: FLOW_SPEC_FILE,
      exists: true,
      valid: true,
      spec_id: result.manifest.spec_id,
      exact_ref: result.exactRef,
      manifest_valid: true,
      provider_supported: result.providerSupported,
      provider_check_required: result.providerSupported,
      local_review_gate_valid: result.localReviewGateValid,
      remote_readback_required: true,
      publication: result.manifest.publication,
      review: result.manifest.review,
    };
  } catch (error) {
    const cliError =
      error instanceof CliError ? error : new CliError("UNEXPECTED_ERROR", String(error));
    return {
      path: FLOW_SPEC_FILE,
      exists: true,
      valid: false,
      error: {
        code: cliError.code,
        message: cliError.message,
        ...(cliError.details ? { details: cliError.details } : {}),
      },
    };
  }
}

function spec(repoRoot: string, args: ParsedArgs): void {
  const subcommand = args.positionals[0] || "status";
  if (subcommand === "init") {
    const result = initializeFlowSpec(repoRoot, {
      specId: optionString(args.options, "spec-id"),
      title: optionString(args.options, "title"),
      workspaceId: optionString(args.options, "workspace"),
      document: optionString(args.options, "document"),
      prototypePaths: optionList(args.options, "prototype"),
      inScope: optionList(args.options, "in-scope"),
      outOfScope: optionList(args.options, "out-of-scope"),
      acceptance: optionList(args.options, "acceptance"),
      force: args.options.force === true,
    });
    printJson({
      ok: true,
      action: "spec init",
      file: FLOW_SPEC_FILE,
      manifest: result.manifest,
      exact_ref: result.exactRef,
      manifest_valid: true,
      provider_supported: result.providerSupported,
      provider_check_required: result.providerSupported,
      next_steps: [
        "检查 .flow/spec.json 并提交到产品仓库",
        "执行 tapd-context spec validate",
        "在 Agent 中说：/tapd 从当前产品仓库发布需求",
      ],
    });
    return;
  }
  if (subcommand === "validate" || subcommand === "status") {
    const result = readAndValidateFlowSpec(repoRoot);
    printJson({
      ok: true,
      action: `spec ${subcommand}`,
      file: FLOW_SPEC_FILE,
      spec_id: result.manifest.spec_id,
      exact_ref: result.exactRef,
      manifest_valid: true,
      provider_supported: result.providerSupported,
      provider_check_required: result.providerSupported,
      local_review_gate_valid: result.localReviewGateValid,
      remote_readback_required: true,
      publication: result.manifest.publication,
      review: result.manifest.review,
    });
    return;
  }
  if (subcommand === "render") {
    const result = readAndValidateFlowSpec(repoRoot);
    printJson({
      ok: true,
      action: "spec render",
      file: FLOW_SPEC_FILE,
      manifest_valid: true,
      provider_supported: result.providerSupported,
      provider_check_required: result.providerSupported,
      requirement: renderFlowRequirement(result),
    });
    return;
  }
  throw new CliError("INVALID_ARGUMENT", "spec 仅支持 init、validate、status 或 render。");
}

function teamPolicyStatus(repoRoot: string): Record<string, unknown> {
  const path = join(repoRoot, TEAM_POLICY_FILE);
  if (!existsSync(path)) {
    return { path: TEAM_POLICY_FILE, exists: false };
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    validateTeamPolicy(value);
    return {
      path: TEAM_POLICY_FILE,
      exists: true,
      valid: true,
    };
  } catch (error) {
    return {
      path: TEAM_POLICY_FILE,
      exists: true,
      valid: false,
      error: error instanceof Error ? error.message : "team policy 无效。",
    };
  }
}

function activeContextStatus(repoRoot: string): Record<string, unknown> {
  const path = join(repoRoot, ACTIVE_CONTEXT_FILE);
  const exists = existsSync(path);
  const status: Record<string, unknown> = {
    path: ACTIVE_CONTEXT_FILE,
    exists,
    gitignored: isPathIgnored(repoRoot, ACTIVE_CONTEXT_FILE),
  };
  if (!exists) {
    return status;
  }
  const content = readFileSync(path, "utf8");
  const branch = content.match(/^branch:\s*(.+)$/m)?.[1]?.trim();
  if (branch) {
    status.metadata_branch = branch;
    try {
      const currentBranch = getCurrentBranch(repoRoot);
      status.current_branch = currentBranch;
      status.stale = currentBranch !== branch;
    } catch {
      status.stale = true;
    }
  }
  return status;
}

const HOOK_BEGIN = "# tapd-context managed block begin";
const HOOK_END = "# tapd-context managed block end";
const HOOK_BLOCK = `${HOOK_BEGIN}
tapd-context sync --silent --current-branch --on-checkout || true
${HOOK_END}`;

function hookPath(repoRoot: string): string {
  return getGitPath(repoRoot, "hooks/post-checkout");
}

function hookStatus(repoRoot: string): Record<string, unknown> {
  const path = hookPath(repoRoot);
  if (!existsSync(path)) {
    return {
      path,
      installed: false,
      managed_block: false,
    };
  }
  const content = readFileSync(path, "utf8");
  return {
    path,
    installed: content.includes(HOOK_BEGIN) && content.includes(HOOK_END),
    managed_block: content.includes(HOOK_BEGIN) && content.includes(HOOK_END),
  };
}

function installHook(repoRoot: string): void {
  const path = hookPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(HOOK_BEGIN)) {
    printJson({ ok: true, action: "hook install", hook: hookStatus(repoRoot) });
    return;
  }
  const prefix = existing.trim()
    ? existing.trimEnd()
    : "#!/bin/sh";
  writeFileSync(path, `${prefix}\n\n${HOOK_BLOCK}\n`, { mode: 0o755 });
  printJson({
    ok: true,
    action: "hook install",
    hook: hookStatus(repoRoot),
    note: "hook 失败不会阻塞 git checkout；如已有复杂 hook，请人工确认 managed block 位置。",
  });
}

function uninstallHook(repoRoot: string): void {
  const path = hookPath(repoRoot);
  if (!existsSync(path)) {
    printJson({ ok: true, action: "hook uninstall", hook: hookStatus(repoRoot) });
    return;
  }
  const content = readFileSync(path, "utf8");
  const pattern = new RegExp(`\\n?${HOOK_BEGIN}[\\s\\S]*?${HOOK_END}\\n?`, "m");
  writeFileSync(path, content.replace(pattern, "\n").trimEnd() + "\n", {
    mode: 0o755,
  });
  printJson({ ok: true, action: "hook uninstall", hook: hookStatus(repoRoot) });
}

function hook(repoRoot: string, args: ParsedArgs): void {
  const subcommand = args.positionals[0] || "status";
  if (subcommand === "install") {
    installHook(repoRoot);
    return;
  }
  if (subcommand === "uninstall") {
    uninstallHook(repoRoot);
    return;
  }
  if (subcommand === "status") {
    printJson({ ok: true, action: "hook status", hook: hookStatus(repoRoot) });
    return;
  }
  throw new CliError("INVALID_ARGUMENT", "hook 仅支持 install、uninstall 或 status。");
}

function logout(): void {
  const removed = logoutCredentials();
  printJson({
    ok: true,
    action: "logout",
    removed_credentials: removed,
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "--help" || args.command === "-h" || !args.command) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.command === "logout") {
    logout();
    return;
  }

  const repoRoot = getRepoRoot(process.cwd());
  switch (args.command) {
    case "init":
      init(repoRoot, args);
      break;
    case "configure":
      configure(repoRoot, args);
      break;
    case "detect-base":
      detectBase(repoRoot);
      break;
    case "start":
      start(repoRoot, args);
      break;
    case "bind":
      bind(repoRoot, args);
      break;
    case "current":
      current(repoRoot, args);
      break;
    case "status":
      current(repoRoot, {
        command: "current",
        positionals: [],
        options: { format: "markdown" },
      });
      break;
    case "sync":
      sync(repoRoot, args);
      break;
    case "refresh":
      sync(repoRoot, { ...args, options: { ...args.options, "current-branch": true } });
      break;
    case "doctor":
      doctor(repoRoot);
      break;
    case "spec":
      spec(repoRoot, args);
      break;
    case "hook":
      hook(repoRoot, args);
      break;
    default:
      throw new CliError("UNKNOWN_COMMAND", `未知命令：${args.command}`);
  }
}

try {
  main();
} catch (error) {
  const cliError =
    error instanceof CliError
      ? error
      : new CliError(
          "UNEXPECTED_ERROR",
          error instanceof Error ? error.message : String(error),
        );
  printJson({
    ok: false,
    error: {
      code: cliError.code,
      message: cliError.message,
      ...(cliError.details ? { details: cliError.details } : {}),
    },
  });
  process.exitCode = 1;
}
