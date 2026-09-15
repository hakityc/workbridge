import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

import { CliError } from "./schema.js";

export function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const cause = error as {
      stderr?: string | Buffer;
      stdout?: string | Buffer;
      status?: number;
    };
    const stderr = String(cause.stderr ?? "").trim();
    const stdout = String(cause.stdout ?? "").trim();
    throw new CliError("GIT_COMMAND_FAILED", stderr || stdout || "Git 命令执行失败。", {
      args,
      status: cause.status,
    });
  }
}

export function getRepoRoot(cwd: string): string {
  try {
    return runGit(["rev-parse", "--show-toplevel"], cwd);
  } catch {
    throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
  }
}

function absoluteGitPath(repoRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

export function getGitDir(repoRoot: string): string {
  try {
    return absoluteGitPath(repoRoot, runGit(["rev-parse", "--git-dir"], repoRoot));
  } catch {
    throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
  }
}

export function getGitCommonDir(repoRoot: string): string {
  try {
    return absoluteGitPath(
      repoRoot,
      runGit(["rev-parse", "--git-common-dir"], repoRoot),
    );
  } catch {
    throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
  }
}

export function getGitPath(repoRoot: string, path: string): string {
  try {
    return absoluteGitPath(repoRoot, runGit(["rev-parse", "--git-path", path], repoRoot));
  } catch {
    throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
  }
}

export function getCurrentBranch(repoRoot: string): string {
  let branch = "";
  try {
    branch = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot);
  } catch {
    throw new CliError("DETACHED_HEAD", "当前仓库处于 detached HEAD，无法绑定分支上下文。");
  }
  if (!branch) {
    throw new CliError("DETACHED_HEAD", "当前仓库处于 detached HEAD，无法绑定分支上下文。");
  }
  return branch;
}

export function getHeadCommit(repoRoot: string): string {
  return runGit(["rev-parse", "HEAD"], repoRoot);
}

export function branchExists(repoRoot: string, branch: string): boolean {
  try {
    runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

export function assertBaseBranch(repoRoot: string, branch: string): void {
  if (!branchExists(repoRoot, branch)) {
    throw new CliError("BASE_BRANCH_NOT_FOUND", `本地 base 分支不存在：${branch}`, {
      base_branch: branch,
    });
  }
}

export function getDirtyEntries(repoRoot: string): string[] {
  const output = runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).tapd/config.json",
      ":(exclude).tapd/project.json",
      ":(exclude).tapd/context.json",
      ":(exclude).tapd/active-context.md",
      ":(exclude).tapd/logs/**",
    ],
    repoRoot,
  );
  return output ? output.split("\n").filter(Boolean) : [];
}

export function assertCleanWorktree(repoRoot: string): void {
  const entries = getDirtyEntries(repoRoot);
  if (entries.length > 0) {
    throw new CliError(
      "WORKTREE_NOT_CLEAN",
      "工作区存在未提交变更；请先提交、手动 stash 或清理后重试。",
      { entries },
    );
  }
}

export function switchBranch(repoRoot: string, branch: string): void {
  runGit(["switch", branch], repoRoot);
}

export function createAndSwitchBranch(repoRoot: string, branch: string): void {
  runGit(["switch", "-c", branch], repoRoot);
}

export interface RestoreResult {
  restored: boolean;
  error?: string;
}

export function tryRestoreBranch(repoRoot: string, originalBranch: string): RestoreResult {
  try {
    switchBranch(repoRoot, originalBranch);
    return { restored: true };
  } catch (error) {
    return {
      restored: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function detectBaseCandidates(repoRoot: string): string[] {
  const candidates: string[] = [];
  try {
    const originHead = runGit(
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      repoRoot,
    ).replace(/^origin\//, "");
    if (originHead) {
      candidates.push(originHead);
    }
  } catch {
    // origin/HEAD is optional.
  }
  for (const branch of ["master", "main"]) {
    if (branchExists(repoRoot, branch) && !candidates.includes(branch)) {
      candidates.push(branch);
    }
  }
  return candidates;
}

export function isPathIgnored(repoRoot: string, path: string): boolean {
  try {
    runGit(["check-ignore", "--quiet", path], repoRoot);
    return true;
  } catch {
    return false;
  }
}
