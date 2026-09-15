# tapd-context

`tapd-context` 管理业务仓库内 Git 分支与 TAPD 工作项的本地绑定。它不调用
TAPD API，也不会执行 `git pull`、`git stash`、提交代码或修改 `.gitignore`。

## Runtime

- 用户运行环境：Node.js 18+，直接执行已提交的 `dist/cli.js`。
- 开发环境：Node.js、npm、固定版本 TypeScript 与 `node:test`。

## Commands

Product repository pilot:

```bash
tapd-context spec init \
  --spec-id order-approval-notification \
  --title "订单审批结果通知" \
  --workspace 12345678 \
  --document docs/requirement.md \
  --prototype 'prototype/index.html|prototype/screen.png' \
  --in-scope '审批结果站内通知|记录处理时间' \
  --out-of-scope '短信通知' \
  --acceptance '审批通过后申请人收到通知|拒绝通知不暴露内部备注'
tapd-context spec validate
tapd-context spec status
tapd-context spec render
```

`spec init` fixes the source to the current exact Git commit and refuses product documents or prototypes that are not present in that commit. Product users normally ask the TAPD skill to initialize the flow; the skill invokes these commands after showing the inferred scope and acceptance points.

```bash
tapd-context detect-base
tapd-context init --base master --workspace 12345678
tapd-context configure --user "开发者A" --profile frontend
tapd-context start --input '{"entity_type":"Story","id":"...","title":"..."}'
tapd-context bind --input '{"entity_type":"Task","id":"..."}'
tapd-context current --format json
tapd-context sync --current-branch
tapd-context doctor
tapd-context hook status
tapd-context status
```

`--input` 的首选格式是 TAPD Context JSON。兼容标准 Story、Task、Bug detail URL、
Story/Task prong view URL 和 Bug bugtrace view URL。URL 缺少标题或用户时，
CLI 保持缺失，不生成虚假值。

## Local files

CLI 新版本默认写：

- `.tapd/config.json`：项目低敏配置。
- `.tapd/team.json`：团队共享策略，可提交仓库；CLI 不修改。
- `$GIT_DIR/tapd-context/`：本机分支绑定，不进入业务仓库。
- `~/.tapd-context/cache/`：个人本机工作项快照。
- `.tapd/active-context.md`：Agent 可读渲染产物，必须 gitignored。

`.tapd/project.json` 仅用于读取旧版本配置；`.tapd/context.json` 仅用于旧版本只读迁移。日志目录 `.tapd/logs/` 预留给调用方。CLI 会提示将本地生成路径加入 `.gitignore`，但不会自行修改项目文件。

默认分支模板为 `{type}/tapd-{entity}-{id}-{slug}`。同事 checkout 规范分支后，`current` / `sync --current-branch` 可从分支名恢复低置信度上下文，再由 skill 通过 MCP 补全。
