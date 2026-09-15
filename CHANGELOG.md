# Changelog

## 0.1.0-rc.1 - 2026-09-15

- First WorkBridge release candidate under the renamed repository and skill identity.
- Retire the former TAPD skill entry and publish only the `workbridge` skill.

The entries below describe the pre-WorkBridge TAPD implementation history.

## Unreleased

- Package the complete skill under `tapd/` so standard Skills CLI installs include references, schemas, and the bundled CLI.
- Add executable `tapd-context spec init/validate/status/render` commands for product-repository onboarding, deterministic TAPD payloads, and publish gates.
- Add an MCP capability and read-only connectivity probe for pilot diagnostics.
- Expand TAPD Skill into a provider-neutral Flow team delivery workflow, with TAPD as the first Provider.
- Add the `.flow/spec.json` contract and an example product specification Manifest.
- Add idempotent product Git Repo to TAPD Story publishing with exact Git version tracking and managed description blocks.
- Add a human-confirmed product review Gate, reviewed-version freezing, and post-review specification change detection.
- Add a pre-development review workflow for high-impact product document, prototype, task, and acceptance gaps.
- Require user confirmation before syncing confirmed review issues to TAPD comments.
- Add committed `.tapd/team.json` policy with profile-specific task prefixes and update scopes.
- Change effort writeback to confirmation-first by default; explicit team or personal policy can opt into automatic writeback.
- Preserve profile, workflow, and effort overrides when `tapd-context configure` rewrites local config.
- Add a read-only team iteration review for WIP, overdue, blocked, and unowned tasks.

## 1.3.1 - 2026-06-17

- Make task orchestration automatically run effort scheduling and write back effort/begin/due for tasks owned by the current user.
- Add opt-out wording for users who only want task creation without effort writeback.
- Document effort defaults and allow `.tapd/config.json` to declare an `effort` section.

## 1.3.0 - 2026-06-16

- Move default branch context storage from `.tapd/context.json` to `$GIT_DIR/tapd-context`.
- Add personal TAPD context cache under `~/.tapd-context/cache` and generated `.tapd/active-context.md`.
- Add branch-name recovery for `tapd-story|task|bug-<id>` branches.
- Add `sync`, `refresh`, `doctor`, `hook`, and `logout` CLI commands.
- Keep legacy `.tapd/context.json` as read-only migration input.

## 1.2.0 - 2026-06-16

- Add a read-only TAPD daily/standup brief workflow.
- Summarize today's tasks, bugs, comments, timesheets, risks, and next work in a concise template.
- Keep the brief independent from Git branch context.

## 1.1.1 - 2026-06-15

- Promote Bug intake to the main MCP workflow.
- Support TAPD Bug bugtrace view URLs.
- Keep all TAPD remote reads and writes behind MCP tools.
- Remove the direct OpenAPI fallback path.

## 1.1.0 - 2026-06-15

- Generate minimal `.tapd/config.json` on first use after base confirmation.
- Keep backward compatibility with `.tapd/project.json`.
- Add Story/Task prong view URL support and workspace mismatch protection.
- Resolve Task intake through its parent Story.
- Add daily development execution and finish workflows.
- Simplify TAPD MCP setup to a personal token.
- Expand CLI integration tests and add GitHub Actions validation.

## 1.0.0 - 2026-06-12

- Publish the sanitized P0 TAPD skill.
- Add branch-level context memory and the bundled `tapd-context` CLI.
