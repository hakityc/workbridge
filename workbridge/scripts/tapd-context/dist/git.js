import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { CliError } from "./schema.js";
export function runGit(args, cwd) {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
    }
    catch (error) {
        const cause = error;
        const stderr = String(cause.stderr ?? "").trim();
        const stdout = String(cause.stdout ?? "").trim();
        throw new CliError("GIT_COMMAND_FAILED", stderr || stdout || "Git 命令执行失败。", {
            args,
            status: cause.status,
        });
    }
}
export function getRepoRoot(cwd) {
    try {
        return runGit(["rev-parse", "--show-toplevel"], cwd);
    }
    catch {
        throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
    }
}
function absoluteGitPath(repoRoot, value) {
    return isAbsolute(value) ? value : resolve(repoRoot, value);
}
export function getGitDir(repoRoot) {
    try {
        return absoluteGitPath(repoRoot, runGit(["rev-parse", "--git-dir"], repoRoot));
    }
    catch {
        throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
    }
}
export function getGitCommonDir(repoRoot) {
    try {
        return absoluteGitPath(repoRoot, runGit(["rev-parse", "--git-common-dir"], repoRoot));
    }
    catch {
        throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
    }
}
export function getGitPath(repoRoot, path) {
    try {
        return absoluteGitPath(repoRoot, runGit(["rev-parse", "--git-path", path], repoRoot));
    }
    catch {
        throw new CliError("NOT_GIT_REPO", "当前目录不在 Git 仓库中。");
    }
}
export function getCurrentBranch(repoRoot) {
    let branch = "";
    try {
        branch = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot);
    }
    catch {
        throw new CliError("DETACHED_HEAD", "当前仓库处于 detached HEAD，无法绑定分支上下文。");
    }
    if (!branch) {
        throw new CliError("DETACHED_HEAD", "当前仓库处于 detached HEAD，无法绑定分支上下文。");
    }
    return branch;
}
export function getHeadCommit(repoRoot) {
    return runGit(["rev-parse", "HEAD"], repoRoot);
}
export function branchExists(repoRoot, branch) {
    try {
        runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
        return true;
    }
    catch {
        return false;
    }
}
export function assertBaseBranch(repoRoot, branch) {
    if (!branchExists(repoRoot, branch)) {
        throw new CliError("BASE_BRANCH_NOT_FOUND", `本地 base 分支不存在：${branch}`, {
            base_branch: branch,
        });
    }
}
export function getDirtyEntries(repoRoot) {
    const output = runGit([
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
    ], repoRoot);
    return output ? output.split("\n").filter(Boolean) : [];
}
export function assertCleanWorktree(repoRoot) {
    const entries = getDirtyEntries(repoRoot);
    if (entries.length > 0) {
        throw new CliError("WORKTREE_NOT_CLEAN", "工作区存在未提交变更；请先提交、手动 stash 或清理后重试。", { entries });
    }
}
export function switchBranch(repoRoot, branch) {
    runGit(["switch", branch], repoRoot);
}
export function createAndSwitchBranch(repoRoot, branch) {
    runGit(["switch", "-c", branch], repoRoot);
}
export function tryRestoreBranch(repoRoot, originalBranch) {
    try {
        switchBranch(repoRoot, originalBranch);
        return { restored: true };
    }
    catch (error) {
        return {
            restored: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export function detectBaseCandidates(repoRoot) {
    const candidates = [];
    try {
        const originHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repoRoot).replace(/^origin\//, "");
        if (originHead) {
            candidates.push(originHead);
        }
    }
    catch {
        // origin/HEAD is optional.
    }
    for (const branch of ["master", "main"]) {
        if (branchExists(repoRoot, branch) && !candidates.includes(branch)) {
            candidates.push(branch);
        }
    }
    return candidates;
}
export function isPathIgnored(repoRoot, path) {
    try {
        runGit(["check-ignore", "--quiet", path], repoRoot);
        return true;
    }
    catch {
        return false;
    }
}
