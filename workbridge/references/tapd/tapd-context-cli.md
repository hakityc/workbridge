# tapd-context CLI Contract

## Runtime

- 用户运行：Node.js 18+ 和 bundled `dist/cli.js`。
- 开发验收：Node.js、npm、TypeScript、`node:test`。
- CLI 不调用 TAPD API，不读取或保存 token。

## Commands

```bash
tapd-context detect-base
tapd-context init --base "<confirmed-branch>" [--workspace "<id>"] [--user "<nick>"] [--profile "<profile>"] [--force]
tapd-context configure [--user "<nick>"] [--profile "<profile>"] [--base "<branch>"] [--workspace "<id>"]
tapd-context start --input '<context-json-or-standard-url>' [--slug '<english-slug>']
tapd-context bind --input '<context-json-or-standard-url>' [--force]
tapd-context current --format json
tapd-context current --format markdown
tapd-context status
tapd-context sync --current-branch
tapd-context refresh
tapd-context doctor
tapd-context hook install|uninstall|status
tapd-context logout
```

`init` 必须接收已经由 skill 向用户确认的 base，不会静默采用候选值。workspace 可从输入 URL/JSON 取得；user nick 不是初始化必填项。

## Files

- `.tapd/config.json`：base、workspace、可选用户 nick 和分支模板。
- `.tapd/team.json`：可提交仓库的团队共享策略；CLI 不写该文件，由 skill 按 `team-policy.md` 读取。
- `.tapd/project.json`：只读兼容旧版本配置；`configure` 可迁移为 config。
- `$GIT_DIR/tapd-context/branches/<branch-hash>.json`：当前仓库本机分支绑定，只存 workspace、类型、ID、绑定方式和 Git commit。
- `~/.tapd-context/cache/tapd/<workspace>/<type>/<id>.json`：个人本机工作项快照；不是 TAPD 事实源。
- `.tapd/active-context.md`：Agent 可读渲染产物，必须 gitignored。
- `.tapd/context.json`：只读兼容旧版 `branches` 映射；成功读取当前分支后迁移到 `$GIT_DIR/tapd-context`，新版本不默认写入。

第一版 context 使用：

```json
{
  "binding": {"method": "start"},
  "status": {
    "local_phase": "initialized",
    "last_synced_at": null
  }
}
```

`binding.method` 可为 `start` 或 `bind`。不保存 `progress`，不自动维护研发阶段或 TAPD 状态。

默认分支模板：

```text
{type}/tapd-{entity}-{id}-{slug}
```

默认类型映射：Story=`feat`、Task=`task`、Bug=`fix`。分支名解析支持 `tapd-story-<id>`、`tapd-task-<id>`、`tapd-bug-<id>`；`tapd-<id>` 作为低置信度兼容简写。

## Input

Context JSON 主路径要求：

- `entity_type`: Story、Task 或 Bug，大小写容错。
- `id`: 总是转换并保存为字符串。
- `title/user_nick/url/workspace_id`: 可选；缺失时保持缺失。

URL 支持标准 detail、Story/Task prong view 和 Bug bugtrace view 路径。JSON 同时提供 URL 时，URL 解析出的类型、ID 和 workspace 优先，避免绑定错误对象。

## Git Safety

`start` 的 dirty 检查只排除：

```text
.tapd/project.json
.tapd/config.json
.tapd/context.json
.tapd/active-context.md
.tapd/logs/**
```

其他 `.tapd` 文件仍是普通变更。`start` 从本地 base HEAD 创建分支，不 pull、不 stash。失败时尝试恢复 `original_branch`；恢复失败返回人工命令。

## Stable Errors

- `NOT_GIT_REPO`
- `DETACHED_HEAD`
- `PROJECT_NOT_INITIALIZED`
- `PROJECT_ALREADY_INITIALIZED`
- `INVALID_CONFIG_FILE`
- `INVALID_PROJECT_FILE`
- `INVALID_CONTEXT_FILE`
- `CONTEXT_NOT_FOUND`
- `INVALID_INPUT_JSON`
- `MISSING_WORK_ITEM_ID`
- `MISSING_WORK_ITEM_TYPE`
- `UNSUPPORTED_TAPD_URL`
- `WORKTREE_NOT_CLEAN`
- `BASE_BRANCH_NOT_FOUND`
- `WORKSPACE_MISMATCH`
- `CONTEXT_ALREADY_BOUND`
- `BRANCH_CREATE_FAILED`
- `CONFIG_WRITE_FAILED`
- `CONTEXT_WRITE_FAILED`
- `RESTORE_FAILED`

错误以 JSON 输出：

```json
{
  "ok": false,
  "error": {
    "code": "CONTEXT_NOT_FOUND",
    "message": "当前分支没有 TAPD 上下文绑定。",
    "details": {"branch": "master"}
  }
}
```

调用方只依赖 `error.code` 做流程分支。

## Output Privacy

`current --format json` 返回工作项必要字段、assignee、binding、git 和 status；不返回 raw、完整 description、token 或 logs。

markdown/status 只显示分支、类型、ID、标题、URL、workspace、负责人、绑定方式、local phase 和 base。

`current` 输出包含 `source` 和 `confidence`。`source=branch-name` 且低置信度时可继续本地开发，但远端 TAPD 写入必须先用 MCP 强校验。

`active-context.md` 顶部包含 branch guard 元数据；读取前必须确认当前 Git branch 与 metadata.branch 一致。
