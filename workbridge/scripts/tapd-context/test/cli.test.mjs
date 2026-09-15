import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const contextHomes = new Map();

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "tapd-context-"));
  git(cwd, "init", "-b", "master");
  git(cwd, "config", "user.email", "tapd-context@example.test");
  git(cwd, "config", "user.name", "TAPD Context Test");
  writeFileSync(join(cwd, "README.md"), "test\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-m", "initial");
  return cwd;
}

function contextHome(cwd) {
  if (!contextHomes.has(cwd)) {
    contextHomes.set(cwd, mkdtempSync(join(tmpdir(), "tapd-context-home-")));
  }
  return contextHomes.get(cwd);
}

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      TAPD_CONTEXT_HOME: contextHome(cwd),
    },
  });
  const output = result.stdout.trim();
  return {
    ...result,
    json: output.startsWith("{") ? JSON.parse(output) : undefined,
  };
}

function input(overrides = {}) {
  return JSON.stringify({
    source: "tapd",
    entity_type: "Story",
    id: "1112345678000000001",
    short_id: "1302826",
    title: "order-approval-risk-flag",
    url: "https://www.tapd.cn/tapd_fe/12345678/story/detail/1112345678000000001",
    user_nick: "开发者A",
    ...overrides,
  });
}

function specInitArgs() {
  return [
    "spec",
    "init",
    "--spec-id",
    "approval-notification",
    "--title",
    "Approval notification",
    "--workspace",
    "12345678",
    "--document",
    "docs/./requirement.md",
    "--prototype",
    "prototype/./index.html|prototype/screen.png",
    "--in-scope",
    "Notify applicant|Record processing time",
    "--out-of-scope",
    "SMS notification",
    "--acceptance",
    "Approval sends a notice|Rejection hides internal notes",
  ];
}

test("init, start, current and status form the P0 happy path", () => {
  const cwd = repo();
  const initialized = run(
    cwd,
    "init",
    "--base",
    "master",
    "--workspace",
    "12345678",
    "--user",
    "开发者A",
  );
  assert.equal(initialized.status, 0);
  assert.equal(initialized.json.ok, true);
  assert.equal(initialized.json.config_file, ".tapd/config.json");

  const started = run(cwd, "start", "--input", input());
  assert.equal(started.status, 0);
  assert.match(started.json.branch, /^feat\/tapd-story-1112345678000000001-order-approval-risk-flag$/);
  assert.equal(started.json.context.binding.method, "start");
  assert.equal(started.json.context.status.local_phase, "initialized");
  assert.equal(started.json.context.status.progress, undefined);
  assert.match(started.json.based_on.note, /本地 base_branch 当前 HEAD/);
  assert.equal(existsSync(join(cwd, ".tapd", "context.json")), false);
  assert.equal(existsSync(join(cwd, ".tapd", "active-context.md")), true);

  const current = run(cwd, "current", "--format", "json");
  assert.equal(current.status, 0);
  assert.equal(current.json.context.work_item.id, "1112345678000000001");
  assert.equal(current.json.context.source, "git-dir-binding");
  assert.equal(current.stdout.includes("raw"), false);

  const status = run(cwd, "status");
  assert.equal(status.status, 0);
  assert.match(status.stdout, /当前分支：feat\//);
  assert.match(status.stdout, /来源：git-dir-binding/);
  assert.equal(status.stdout.includes("raw"), false);
});

test("dirty check ignores only generated local state paths", () => {
  const cwd = repo();
  assert.equal(run(cwd, "init", "--base", "master").status, 0);

  mkdirSync(join(cwd, ".tapd", "logs"), { recursive: true });
  writeFileSync(join(cwd, ".tapd", "logs", "run.log"), "local log\n");
  assert.equal(run(cwd, "start", "--input", input()).status, 0);

  git(cwd, "switch", "master");
  writeFileSync(join(cwd, ".tapd", "README.md"), "must remain visible\n");
  const blocked = run(cwd, "start", "--input", input({ id: "2", short_id: "2" }));
  assert.equal(blocked.status, 1);
  assert.equal(blocked.json.error.code, "WORKTREE_NOT_CLEAN");
  assert.match(JSON.stringify(blocked.json.error.details), /\.tapd\/README\.md/);
});

test("bind refuses overwrite unless force is explicit", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--user", "开发者A");
  const first = run(cwd, "bind", "--input", input());
  assert.equal(first.status, 0);
  assert.equal(first.json.context.binding.method, "bind");
  assert.equal(first.json.context.status.local_phase, "initialized");

  const replacement = input({
    id: "99",
    url: "https://www.tapd.cn/tapd_fe/12345678/story/detail/99",
  });
  const conflict = run(cwd, "bind", "--input", replacement);
  assert.equal(conflict.status, 1);
  assert.equal(conflict.json.error.code, "CONTEXT_ALREADY_BOUND");

  const forced = run(cwd, "bind", "--input", replacement, "--force");
  assert.equal(forced.status, 0);
  assert.equal(forced.json.context.work_item.id, "99");
});

test("branch collisions append numeric suffixes", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master");
  const first = run(cwd, "start", "--input", input());
  assert.equal(first.status, 0);
  git(cwd, "switch", "master");
  const second = run(cwd, "start", "--input", input());
  assert.equal(second.status, 0);
  assert.equal(second.json.branch, `${first.json.branch}-2`);
});

test("current returns stable errors for missing, invalid and detached context", () => {
  const cwd = repo();
  const missing = run(cwd, "current");
  assert.equal(missing.json.error.code, "CONTEXT_NOT_FOUND");

  mkdirSync(join(cwd, ".tapd"), { recursive: true });
  writeFileSync(join(cwd, ".tapd", "context.json"), "{bad");
  const invalid = run(cwd, "current");
  assert.equal(invalid.json.error.code, "INVALID_CONTEXT_FILE");

  git(cwd, "checkout", "--detach");
  const detached = run(cwd, "current");
  assert.equal(detached.json.error.code, "DETACHED_HEAD");
});

test("legacy .tapd/context.json is read-only and migrated to git-dir storage", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--workspace", "12345678");
  mkdirSync(join(cwd, ".tapd"), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(cwd, ".tapd", "context.json"),
    `${JSON.stringify(
      {
        version: 1,
        branches: {
          master: {
            branch: "master",
            created_at: now,
            updated_at: now,
            binding: { method: "bind" },
            git: {
              base_branch: "master",
              source_branch: "master",
              created_from_commit: git(cwd, "rev-parse", "HEAD"),
            },
            work_item: {
              source: "tapd",
              entity_type: "Story",
              id: "legacy-1",
              title: "legacy story",
              workspace_id: "12345678",
            },
            assignee: { display_name: "开发者A" },
            status: { local_phase: "initialized", last_synced_at: null },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const current = run(cwd, "current", "--format", "json");
  assert.equal(current.status, 0);
  assert.equal(current.json.context.source, "legacy-context");
  assert.equal(current.json.migration.from, ".tapd/context.json");
  assert.equal(readFileSync(join(cwd, ".tapd", "context.json"), "utf8").includes("legacy-1"), true);

  const again = run(cwd, "current", "--format", "json");
  assert.equal(again.status, 0);
  assert.equal(again.json.context.source, "git-dir-binding");
});

test("branch name resolver restores a low-confidence context without repo context file", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--workspace", "12345678");
  git(cwd, "switch", "-c", "feat/tapd-story-888999-login-timeout");

  const current = run(cwd, "current", "--format", "json");
  assert.equal(current.status, 0);
  assert.equal(current.json.context.source, "branch-name");
  assert.equal(current.json.context.confidence, 50);
  assert.equal(current.json.context.work_item.entity_type, "Story");
  assert.equal(current.json.context.work_item.id, "888999");
  assert.equal(current.json.context.work_item.workspace_id, "12345678");
  assert.equal(existsSync(join(cwd, ".tapd", "active-context.md")), true);
});

test("start reports project initialization and standard URL compatibility", () => {
  const cwd = repo();
  const uninitialized = run(cwd, "start", "--input", input());
  assert.equal(uninitialized.json.error.code, "PROJECT_NOT_INITIALIZED");
  assert.deepEqual(uninitialized.json.error.details.candidates, ["master"]);
  assert.equal(uninitialized.json.error.details.workspace_id, "12345678");

  run(cwd, "init", "--base", "master");
  const started = run(
    cwd,
    "start",
    "--input",
    "https://tapd.example.test/tapd_fe/12345678/task/detail/1112345678000000002",
  );
  assert.equal(started.status, 0);
  assert.equal(started.json.context.work_item.entity_type, "Task");
  assert.equal(started.json.context.work_item.title, undefined);
  assert.equal(started.json.context.assignee.display_name, "");
});

test("detect-base returns candidates without writing project config", () => {
  const cwd = repo();
  const detected = run(cwd, "detect-base");
  assert.deepEqual(detected.json.candidates, ["master"]);
  assert.throws(() => readFileSync(join(cwd, ".tapd", "config.json")));
});

test("start restores original branch when branch creation fails", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master");
  const projectPath = join(cwd, ".tapd", "config.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.branch.name_template = "invalid..{slug}";
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);

  const failed = run(cwd, "start", "--input", input());
  assert.equal(failed.status, 1);
  assert.equal(failed.json.error.code, "BRANCH_CREATE_FAILED");
  assert.equal(failed.json.error.details.restored, true);
  assert.equal(git(cwd, "branch", "--show-current"), "master");
});

test("init can generate minimal config and configure adds optional identity", () => {
  const cwd = repo();
  const initialized = run(
    cwd,
    "init",
    "--base",
    "master",
    "--workspace",
    "12345678",
  );
  assert.equal(initialized.status, 0);
  const configPath = join(cwd, ".tapd", "config.json");
  const minimal = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(minimal.base_branch, "master");
  assert.equal(minimal.workspace_id, "12345678");
  assert.equal(minimal.user_nick, undefined);

  const configured = run(
    cwd,
    "configure",
    "--user",
    "开发者A",
    "--profile",
    "frontend",
  );
  assert.equal(configured.status, 0);
  const updated = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(updated.user_nick, "开发者A");
  assert.equal(updated.profile, "frontend");
});

test("configure preserves team-oriented local overrides", () => {
  const cwd = repo();
  assert.equal(run(cwd, "init", "--base", "master", "--workspace", "12345678").status, 0);

  const configPath = join(cwd, ".tapd", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.profile = "backend";
  config.workflow = { effort_writeback: "confirm" };
  config.effort = {
    capacity_per_week_hours: 24,
    wip_limit: 1,
    ai_coding_factor: 0.6,
    integration_factor: 0.9,
    planning_factor: 0.8,
    buffer_percent: 0.3,
    auto_writeback: false,
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const configured = run(cwd, "configure", "--user", "开发者A");
  assert.equal(configured.status, 0);

  const updated = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(updated.user_nick, "开发者A");
  assert.equal(updated.profile, "backend");
  assert.deepEqual(updated.workflow, { effort_writeback: "confirm" });
  assert.deepEqual(updated.effort, config.effort);
});

test("legacy project config remains readable and configure migrates it", () => {
  const cwd = repo();
  mkdirSync(join(cwd, ".tapd"), { recursive: true });
  writeFileSync(
    join(cwd, ".tapd", "project.json"),
    `${JSON.stringify({
      version: 1,
      user: { display_name: "开发者A" },
      git: { base_branch: "master" },
      branch: {
        type_map: { Story: "feat", Task: "feat", Bug: "hotfix" },
        name_template: "{type}/{date}/{slug}",
        date_format: "YYMMDD",
        slug_language: "en",
      },
      tapd: { workspace_id: "12345678" },
    })}\n`,
  );
  const bound = run(cwd, "bind", "--input", input());
  assert.equal(bound.status, 0);
  assert.equal(bound.json.context.assignee.display_name, "开发者A");

  const migrated = run(cwd, "configure", "--user", "开发者B");
  assert.equal(migrated.status, 0);
  assert.equal(migrated.json.migrated_from_legacy, true);
  assert.equal(
    JSON.parse(readFileSync(join(cwd, ".tapd", "config.json"), "utf8")).user_nick,
    "开发者B",
  );
});

test("prong Story and Task links are accepted", () => {
  const storyRepo = repo();
  run(storyRepo, "init", "--base", "master", "--workspace", "12345678");
  const story = run(
    storyRepo,
    "bind",
    "--input",
    "https://www.tapd.cn/12345678/prong/stories/view/1112345678000000001",
  );
  assert.equal(story.status, 0);
  assert.equal(story.json.context.work_item.entity_type, "Story");

  const taskRepo = repo();
  run(taskRepo, "init", "--base", "master", "--workspace", "12345678");
  const task = run(
    taskRepo,
    "bind",
    "--input",
    "https://www.tapd.cn/12345678/prong/tasks/view/1112345678000000002",
  );
  assert.equal(task.status, 0);
  assert.equal(task.json.context.work_item.entity_type, "Task");
});

test("bugtrace Bug links are accepted", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--workspace", "12345678");

  const result = run(
    cwd,
    "bind",
    "--input",
    "https://www.tapd.cn/12345678/bugtrace/bugs/view/1112345678000000003",
  );

  assert.equal(result.status, 0);
  assert.equal(result.json.context.work_item.entity_type, "Bug");
  assert.equal(result.json.context.work_item.id, "1112345678000000003");
  assert.equal(result.json.context.work_item.workspace_id, "12345678");
});

test("workspace mismatch is rejected before branch creation", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--workspace", "87654321");
  const result = run(cwd, "start", "--input", input());
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "WORKSPACE_MISMATCH");
  assert.equal(git(cwd, "branch", "--show-current"), "master");
});

test("invalid new and legacy config files keep distinct stable errors", () => {
  const newConfigRepo = repo();
  mkdirSync(join(newConfigRepo, ".tapd"), { recursive: true });
  writeFileSync(join(newConfigRepo, ".tapd", "config.json"), "{bad");
  const invalidConfig = run(newConfigRepo, "bind", "--input", input());
  assert.equal(invalidConfig.json.error.code, "INVALID_CONFIG_FILE");

  const legacyRepo = repo();
  mkdirSync(join(legacyRepo, ".tapd"), { recursive: true });
  writeFileSync(join(legacyRepo, ".tapd", "project.json"), "{bad");
  const invalidLegacy = run(legacyRepo, "bind", "--input", input());
  assert.equal(invalidLegacy.json.error.code, "INVALID_PROJECT_FILE");
});

test("sync, doctor, hook and logout expose local lifecycle operations", () => {
  const cwd = repo();
  run(cwd, "init", "--base", "master", "--workspace", "12345678");
  const started = run(cwd, "start", "--input", input());
  assert.equal(started.status, 0);
  const teamPolicy = {
    version: 1,
    defaults: {
      profile: "frontend",
      effort_writeback: "confirm",
      status_transition: "never",
    },
    task: {
      prefix_by_profile: { frontend: "【前端】" },
      update_scope_by_profile: { frontend: "self" },
    },
    permissions: {
      write_actions_by_profile: {
        frontend: ["create-task", "update-self-task", "write-effort"],
      },
    },
  };
  writeFileSync(
    join(cwd, ".tapd", "team.json"),
    `${JSON.stringify(teamPolicy, null, 2)}\n`,
  );

  const synced = run(cwd, "sync", "--current-branch");
  assert.equal(synced.status, 0);
  assert.equal(synced.json.action, "sync");
  assert.equal(synced.json.active_context, ".tapd/active-context.md");

  const silent = run(cwd, "sync", "--current-branch", "--silent");
  assert.equal(silent.status, 0);
  assert.equal(silent.stdout.trim(), "");

  const doctor = run(cwd, "doctor");
  assert.equal(doctor.status, 0);
  assert.equal(doctor.json.action, "doctor");
  assert.equal(doctor.json.current.ok, true);
  assert.equal(doctor.json.active_context.stale, false);
  assert.equal(doctor.json.hook.installed, false);
  assert.equal(doctor.json.team_policy.exists, true);
  assert.equal(doctor.json.team_policy.valid, true);

  writeFileSync(
    join(cwd, ".tapd", "team.json"),
    `${JSON.stringify({ version: 1, defaults: {}, task: {} }, null, 2)}\n`,
  );
  const invalidTeamPolicy = run(cwd, "doctor");
  assert.equal(invalidTeamPolicy.status, 0);
  assert.equal(invalidTeamPolicy.json.team_policy.valid, false);
  assert.match(invalidTeamPolicy.json.team_policy.error, /defaults\.profile/);

  writeFileSync(
    join(cwd, ".tapd", "team.json"),
    `${JSON.stringify({ ...teamPolicy, workspace_id: 123 }, null, 2)}\n`,
  );
  const invalidWorkspace = run(cwd, "doctor");
  assert.equal(invalidWorkspace.json.team_policy.valid, false);
  assert.match(invalidWorkspace.json.team_policy.error, /workspace_id/);

  writeFileSync(
    join(cwd, ".tapd", "team.json"),
    `${JSON.stringify({
      ...teamPolicy,
      task: {
        ...teamPolicy.task,
        prefix_by_profile: { frontend: " " },
      },
    }, null, 2)}\n`,
  );
  const invalidPrefix = run(cwd, "doctor");
  assert.equal(invalidPrefix.json.team_policy.valid, false);
  assert.match(invalidPrefix.json.team_policy.error, /prefix_by_profile/);

  const installed = run(cwd, "hook", "install");
  assert.equal(installed.status, 0);
  assert.equal(installed.json.hook.installed, true);
  const hookStatus = run(cwd, "hook", "status");
  assert.equal(hookStatus.json.hook.managed_block, true);
  const uninstalled = run(cwd, "hook", "uninstall");
  assert.equal(uninstalled.status, 0);
  assert.equal(uninstalled.json.hook.installed, false);

  const logout = run(cwd, "logout");
  assert.equal(logout.status, 0);
  assert.equal(logout.json.action, "logout");
});

test("product can initialize and validate a publishable Flow spec manifest", () => {
  const cwd = repo();
  mkdirSync(join(cwd, "docs"), { recursive: true });
  mkdirSync(join(cwd, "prototype"), { recursive: true });
  writeFileSync(join(cwd, "docs", "requirement.md"), "# Approval notification\n");
  writeFileSync(join(cwd, "prototype", "index.html"), "<main>Prototype</main>\n");
  writeFileSync(join(cwd, "prototype", "screen.png"), "fixture\n");
  git(cwd, "add", "docs", "prototype");
  git(cwd, "commit", "-m", "add product specification");
  git(cwd, "remote", "add", "origin", "https://git.example.test/product/approval.git");

  const initialized = run(cwd, ...specInitArgs());
  assert.equal(initialized.status, 0);
  assert.equal(initialized.json.ok, true);
  assert.equal(initialized.json.action, "spec init");
  assert.equal(initialized.json.manifest.source.ref, git(cwd, "rev-parse", "HEAD"));
  assert.equal(initialized.json.manifest.review.status, "draft");
  assert.equal(initialized.json.manifest.source.document, "docs/requirement.md");
  assert.equal(
    initialized.json.manifest.source.prototype_paths[0],
    "prototype/index.html",
  );
  assert.deepEqual(
    initialized.json.manifest.acceptance.map((item) => item.id),
    ["AC-01", "AC-02"],
  );
  assert.equal(existsSync(join(cwd, ".flow", "spec.json")), true);

  const validated = run(cwd, "spec", "validate");
  assert.equal(validated.status, 0);
  assert.equal(validated.json.ok, true);
  assert.equal(validated.json.manifest_valid, true);
  assert.equal(validated.json.provider_supported, true);
  assert.equal(validated.json.provider_check_required, true);
  assert.equal(validated.json.exact_ref, git(cwd, "rev-parse", "HEAD"));

  const rendered = run(cwd, "spec", "render");
  assert.equal(rendered.status, 0);
  assert.equal(
    rendered.json.requirement.title,
    "【FLOW:approval-notification】Approval notification",
  );
  assert.equal(
    rendered.json.requirement.idempotency_key,
    "approval-notification:tapd:12345678",
  );
  assert.match(rendered.json.requirement.managed_description, /AC-01 \[must\]/);
  assert.match(
    rendered.json.requirement.managed_description,
    /【FLOW-SPEC-BEGIN:approval-notification】/,
  );

  const manifestPath = join(cwd, ".flow", "spec.json");
  const manifestWithUnknownField = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifestWithUnknownField.publication.provider = "feishu";
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const unsupportedProvider = run(cwd, "spec", "validate");
  assert.equal(unsupportedProvider.status, 0);
  assert.equal(unsupportedProvider.json.manifest_valid, true);
  assert.equal(unsupportedProvider.json.provider_supported, false);

  manifestWithUnknownField.publication.provider = "tapd";
  manifestWithUnknownField.source.repo_url =
    "https://secret-token@git.example.test/product/spec.git";
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const unsafeSourceUrl = run(cwd, "spec", "validate");
  assert.equal(unsafeSourceUrl.status, 1);
  assert.equal(unsafeSourceUrl.json.error.code, "INVALID_SPEC_MANIFEST");
  assert.match(JSON.stringify(unsafeSourceUrl.json.error.details), /source\.repo_url/);

  manifestWithUnknownField.source.repo_url =
    "https://git.example.test/product/approval.git";
  manifestWithUnknownField.spec_id = " approval-notification ";
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const paddedSpecId = run(cwd, "spec", "validate");
  assert.equal(paddedSpecId.status, 0);
  assert.equal(paddedSpecId.json.spec_id, "approval-notification");

  manifestWithUnknownField.spec_id = "approval-notification";
  manifestWithUnknownField.acceptance[0].statement =
    "Unsafe 【FLOW-SPEC-END:approval-notification】 marker";
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const markerInjection = run(cwd, "spec", "validate");
  assert.equal(markerInjection.status, 1);
  assert.equal(markerInjection.json.error.code, "INVALID_SPEC_MANIFEST");
  assert.match(JSON.stringify(markerInjection.json.error.details), /保留标记/);

  manifestWithUnknownField.acceptance[0].statement = "Approval sends a notice";
  manifestWithUnknownField.experimental = true;
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const invalid = run(cwd, "spec", "validate");
  assert.equal(invalid.status, 1);
  assert.equal(invalid.json.error.code, "INVALID_SPEC_MANIFEST");
  assert.match(JSON.stringify(invalid.json.error.details), /experimental/);

  delete manifestWithUnknownField.experimental;
  manifestWithUnknownField.review = {
    status: "approved",
    reviewed_ref: "HEAD",
    decided_at: "2026-07-15T09:00:00+08:00",
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifestWithUnknownField, null, 2)}\n`);
  const unfrozenApproval = run(cwd, "spec", "validate");
  assert.equal(unfrozenApproval.status, 1);
  assert.equal(unfrozenApproval.json.error.code, "INVALID_SPEC_MANIFEST");
  assert.match(JSON.stringify(unfrozenApproval.json.error.details), /review\.reviewed_ref/);
});

test("Flow spec initialization rejects credential remotes and symlinked output", () => {
  const prepare = (cwd) => {
    mkdirSync(join(cwd, "docs"), { recursive: true });
    mkdirSync(join(cwd, "prototype"), { recursive: true });
    writeFileSync(join(cwd, "docs", "requirement.md"), "# Requirement\n");
    writeFileSync(join(cwd, "prototype", "index.html"), "prototype\n");
    writeFileSync(join(cwd, "prototype", "screen.png"), "fixture\n");
    git(cwd, "add", "docs", "prototype");
    git(cwd, "commit", "-m", "add specification");
  };

  const credentialRepo = repo();
  prepare(credentialRepo);
  git(
    credentialRepo,
    "remote",
    "add",
    "origin",
    "https://secret-token@git.example.test/product/spec.git",
  );
  const credentialResult = run(credentialRepo, ...specInitArgs());
  assert.equal(credentialResult.status, 1);
  assert.equal(credentialResult.json.error.code, "UNSAFE_GIT_REMOTE_URL");

  const symlinkRepo = repo();
  prepare(symlinkRepo);
  git(
    symlinkRepo,
    "remote",
    "add",
    "origin",
    "https://git.example.test/product/spec.git",
  );
  const outside = mkdtempSync(join(tmpdir(), "flow-spec-outside-"));
  symlinkSync(outside, join(symlinkRepo, ".flow"));
  const symlinkResult = run(symlinkRepo, ...specInitArgs());
  assert.equal(symlinkResult.status, 1);
  assert.equal(symlinkResult.json.error.code, "UNSAFE_SPEC_PATH");
  assert.equal(existsSync(join(outside, "spec.json")), false);

  const dirtyRepo = repo();
  prepare(dirtyRepo);
  git(
    dirtyRepo,
    "remote",
    "add",
    "origin",
    "https://git.example.test/product/spec.git",
  );
  writeFileSync(join(dirtyRepo, "docs", "requirement.md"), "# Uncommitted change\n");
  const dirtyResult = run(dirtyRepo, ...specInitArgs());
  assert.equal(dirtyResult.status, 1);
  assert.equal(dirtyResult.json.error.code, "SPEC_SOURCE_NOT_COMMITTED");

  const normalizedDirtyResult = run(
    dirtyRepo,
    ...specInitArgs().map((value) =>
      value === "docs/./requirement.md" ? "docs\\requirement.md" : value,
    ),
  );
  assert.equal(normalizedDirtyResult.status, 1);
  assert.equal(normalizedDirtyResult.json.error.code, "SPEC_SOURCE_NOT_COMMITTED");
});
