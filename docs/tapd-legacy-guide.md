# 历史 TAPD 使用说明（兼容参考）

新安装和新业务入口以 [WorkBridge](../README.md) 为准。下文保留重构前文档与用户修改；旧 CLI 和 .tapd 格式仅供兼容使用，不作为新安全连接指南。

# TAPD Skill

An AI delivery workflow for teams. It uses a product Git repository as the specification source of truth and TAPD as the first collaboration provider, connecting requirement publishing, product review, development, quality validation, and delivery traceability. Future providers such as Feishu can reuse the same workflow.

[![skills.sh](https://skills.sh/b/hakityc/tapd-skill)](https://skills.sh/hakityc/tapd-skill/tapd)

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh-CN.md)

<!-- README-I18N:END -->

> The workspace IDs, work item IDs, nicknames, and requirement titles in this repository are fictional examples.

## What It Does

- Idempotently creates or updates a TAPD Story from `.flow/spec.json`, binding an exact specification commit and stable acceptance IDs.
- Product users do not hand-write the Manifest: the agent drafts scope and acceptance points, while the bundled CLI enforces Git-version and path safety.
- Builds a product review package, records a human-confirmed decision, freezes `reviewed_ref`, and detects post-review specification changes.
- Reads requirements, tasks, bugs, and prototype information after you paste a Story/Task/Bug link.
- Generates local `.tapd/config.json` in a business repository on first use, then creates a development branch.
- Restores TAPD context from local Git-dir binding or the `tapd-*` branch name in later sessions so you can continue planning, coding, testing, or wrapping up.
- Resolves a Task back to its parent Story; summarizes Bug reproduction steps, impact, related requirements, and regression scope.
- Reviews product docs, prototypes, and tasks before coding for high-impact issues only: rework risk, integration blockers, or acceptance ambiguity; confirmed issues can be synced to TAPD comments.
- Uses dry-run before creating or updating tasks, test cases, comments, or timesheets, then reads back results when MCP capabilities allow it.
- Splits tasks by frontend, backend, QA, product, or lead profile; estimates/schedules only when requested, then writes effort/begin/due after the applicable confirmation gate.
- Generates concise daily/standup briefs: done today, in progress, risks, next work, and data stats.
- Builds a "what should I do today" list from the current iteration's unfinished tasks, ranked by in-progress state, overdue risk, priority, due date, and capacity instead of only tasks due today.

## Why Branch Binding

TAPD is the requirement context. Git branch is the code context.

Binding them lets the agent know, in any later session:

- which Story, Task, or Bug the current branch is for
- where to reload requirement details, parent Story, related tasks, Bug notes, and comments
- what to validate before wrap-up
- which TAPD item should receive comments, timesheet drafts, or completion notes

This solves the most common AI coding problem: context resets between sessions.

## Daily Workflow

| Scenario | Say | What the skill does |
|---|---|---|
| Publish requirement | `/tapd publish from this product repository` | Validates the Manifest, idempotently creates/updates a TAPD Story, and backfills its mapping |
| Initialize product flow | `/tapd initialize Flow for this product repository` | Drafts scope and acceptance from committed docs/prototypes, then generates and validates `.flow/spec.json` |
| Product review | `/tapd prepare product review` | Builds the review package and freezes the human-approved specification version |
| Start a Story | `/tapd start <Story link>` | Creates a branch, binds TAPD, reads the requirement |
| Start a Task | `/tapd start <Task link>` | Reads the Task and resolves its parent Story |
| Fix a Bug | `/tapd fix <Bug link>` | Reads reproduction, impact, comments, and regression scope |
| Pre-dev review | `/tapd review product docs and prototype differences first` | Finds rework/blocker/acceptance issues, then writes confirmed items to TAPD comments |
| Continue work | `/tapd continue` | Restores context from the current Git branch |
| Split tasks | `/tapd create a branch, split tasks, and write back to TAPD` | Creates profile-based tasks, then confirms before filling effort/begin/due |
| Wrap up | `/tapd wrap up` | Checks changes, runs validation, drafts comments and timesheets |
| Standup | `/tapd standup brief` | Summarizes done, in progress, risks, and next work |
| Today plan | `/tapd what should I work on today` | Ranks unfinished tasks in the current iteration into a practical today plan |
| Team review | `/tapd review team load and risks for the current iteration` | Read-only summary of WIP, overdue, blocked, and unowned tasks |

## Install

```bash
npx skills add hakityc/tapd-skill --skill tapd --global --yes
```

The Skills CLI auto-detects the current agent. To target a specific agent, add `--agent <agent-name>`.

## Update

```bash
npx skills update tapd --global --yes
```

## Minimal Setup

This skill does not bundle a TAPD MCP server. The skill orchestrates the workflow; the MCP server owns TAPD access and token handling.

Members do not need to learn `setup`, `doctor`, or `init` commands first: they can simply say “create a requirement” or “start this work item.” The skill diagnoses prerequisites automatically and asks only for the missing step. Each member must still complete a one-time secure TAPD authorization; the skill never stores tokens or asks users to paste one into chat, documentation, or Git.

- MCP official docs: [modelcontextprotocol.io](https://modelcontextprotocol.io/docs/getting-started/intro)
- TAPD MCP server: [`mcp-server-tapd`](https://pypi.org/project/mcp-server-tapd/)
- Compatibility baseline: `mcp-server-tapd==8.0.78`
- Platform setup notes: [`../workbridge/references/tapd/mcp-bootstrap.md`](../workbridge/references/tapd/mcp-bootstrap.md)

When you express a TAPD business intent in a repository for the first time, the skill will:

1. Detect Git base branch candidates.
2. Ask you to confirm the base branch.
3. Generate `.tapd/config.json`.
4. Create a `tapd-story|task|bug-<id>` development branch and bind the current work item.

For team rollout, copy `tapd/examples/team.example.json` to `.tapd/team.json` in the business repository and commit it. It defines shared profile prefixes, update scopes, effort parameters, and writeback policy. Personal identity and overrides remain in the untracked `.tapd/config.json`. Precedence is: current request > personal config > team policy > safe defaults.

In the product repository, commit the product document and prototype. If `.flow/spec.json` is missing, product users can ask the agent to create a requirement from the current document; it drafts scope and acceptance points, then generates and validates the Manifest after confirmation. Product users never need to hand-write JSON; [`tapd/examples/spec-manifest.example.json`](tapd/examples/spec-manifest.example.json) is reference-only. The contract is defined in [`../workbridge/scripts/tapd-context/schemas/spec-manifest.schema.json`](../workbridge/scripts/tapd-context/schemas/spec-manifest.schema.json).

The generated local config looks like this:

```json
{
  "version": 1,
  "base_branch": "master",
  "workspace_id": "12345678"
}
```

## Common Usage

```text
/tapd 开始做 https://www.tapd.cn/12345678/prong/stories/view/1112345678000000001
/tapd 继续开发
/tapd 这个需求做完了，帮我收尾
/tapd 生成今天的站会简报，workspace_id=12345678，当前用户=开发者A
```

Supported common link forms:

```text
/tapd_fe/<workspace_id>/story/detail/<story_id>
/tapd_fe/<workspace_id>/task/detail/<task_id>
/tapd_fe/<workspace_id>/bug/detail/<bug_id>
/<workspace_id>/prong/stories/view/<story_id>
/<workspace_id>/prong/tasks/view/<task_id>
/<workspace_id>/bugtrace/bugs/view/<bug_id>
```

## Local Files

The skill splits state by sensitivity:

```text
.flow/spec.json                    product specification manifest (commit this in the product repository)
.tapd/config.json                  project config
.tapd/team.json                    shared team policy (commit this)
$GIT_DIR/tapd-context/             local branch binding
~/.tapd-context/cache/             personal work item cache
.tapd/active-context.md            generated agent-readable context
.tapd/context.json                 legacy read-only migration path
```

Recommended project `.gitignore` entries:

```gitignore
.tapd/config.json
.tapd/project.json
.tapd/context.json
.tapd/active-context.md
.tapd/logs/
```

The CLI never edits `.gitignore` automatically.

Do not add `.tapd/team.json` to `.gitignore`; it must not contain tokens or personal nicknames.

For painless handoff, keep the default branch naming protocol such as `feat/tapd-story-1112345678000000001-action-item`. A teammate can check out that branch and run `/tapd continue`; the skill can recover the TAPD identity from the branch name and then refresh details through MCP.

## Safety Boundaries

- Does not run `git pull` or `git stash`, and does not auto-commit `.tapd`.
- Does not automatically transition TAPD statuses.
- Reads and writes TAPD remotely only through MCP; it does not call OpenAPI directly.
- Uses dry-run plus user confirmation before remote writes.
- Matches owners exactly to avoid writing to similar nicknames.
- Dirty worktree checks only exclude `.tapd/config.json`, `.tapd/project.json`, `.tapd/context.json`, `.tapd/active-context.md`, and `.tapd/logs/**`.

## Runtime Requirements

For users:

- Git
- Node.js 18+
- TAPD MCP: uv, Python 3.13+, `mcp-server-tapd`

`tapd-context` ships with bundled `dist`, so users do not need npm dependencies.

## Development Validation

```bash
cd ../workbridge/scripts/tapd-context
npm ci
npm test
cd ../..
python3 scripts/quick_validate.py .
```

## Note

This is a community workflow tool and is not affiliated with TAPD. Before using write capabilities, confirm token permissions, the target workspace, and the dry-run content.

Only the TAPD Provider is implemented today. See [`docs/product-vision.md`](docs/product-vision.md) and [`docs/roadmap.md`](docs/roadmap.md) for the product direction and rollout sequence.
