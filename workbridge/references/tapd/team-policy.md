# TAPD 团队策略与个人覆盖

团队推广时，在任何任务编排、估时写回、团队盘点或状态类写入前读取本文件。目标是让团队共享规则与个人身份分离，避免每个成员复制一套不同默认值。

## 配置分层

配置按字段合并，优先级从高到低：

1. 用户本轮明确输入。
2. `.tapd/config.json`：个人本地配置，不提交仓库。
3. `.tapd/team.json`：团队共享策略，应提交仓库。
4. 本 skill 的安全默认值。

`.tapd/team.json` 不得包含 token、个人昵称或其他凭据。团队文件的参考结构见 `examples/team.example.json`；个人文件见 `examples/config.example.json`。

`tapd-context` 仍使用 `.tapd/config.json` 管理本地身份和 Git 配置。首次初始化时若存在 `.tapd/team.json`，skill 可将其中的 `base_branch` 和 `workspace_id` 作为候选展示给用户；base 仍需确认后再执行 init。

## Profile 解析

支持以下 profile：

| profile | 默认任务前缀 | 默认修改范围 |
|---|---|---|
| `frontend` | `【前端】` | `self` |
| `backend` | `【后端】` | `self` |
| `qa` | `【测试】` | `self` |
| `product` | `【产品】` | `self` |
| `lead` | `【研发】` | `self`；仅团队策略显式允许时可升级 |

解析顺序：本轮 `profile` → `.tapd/config.json.profile` → `.tapd/team.json.defaults.profile`。任务创建或批量更新需要 profile，但仍无法确定时询问一次，并可用 `tapd-context configure --profile <profile>` 保存。

任务前缀优先使用 `.tapd/team.json.task.prefix_by_profile[profile]`，缺失时使用表中默认值。不得再把所有任务硬编码为 `【前端】`。

## 修改范围

`task.update_scope_by_profile` 仅允许：

- `self`：只修改 owner token 精确匹配当前用户的任务。
- `explicit-team`：允许操作用户本轮明确点名的成员或任务；仍需展示 owner、旧值、新值并再次确认。

`explicit-team` 不是“修改全部团队任务”的通行证。必须同时满足：

1. 当前 profile 的团队策略值为 `explicit-team`。
2. 用户明确点名目标成员、任务 ID 或给出清晰筛选范围。
3. owner 按 `safety-policy.md` 分隔并精确匹配目标昵称。
4. 写前 dry-run，写后回读。

任一条件不满足时降级为 `self`。不得根据“负责人、组长、管理员”等自然语言自行提升权限。

## 写动作权限

`.tapd/team.json.permissions.write_actions_by_profile` 是团队工作流的附加限制，不能提升 TAPD token 本身的权限。支持的写动作：

- `create-requirement`
- `update-requirement`
- `create-task`
- `update-self-task`
- `update-explicit-team-task`
- `write-effort`
- `create-tcase`
- `create-comment`
- `write-timesheet`
- `transition-status`

执行远端写入前，先确认当前 profile 包含对应动作。缺少团队策略或缺少 profile 条目时使用安全默认：frontend/backend 允许创建和修改本人任务、本人估时、评论与工时；qa 允许本人测试任务、用例、评论与工时；product 允许发布/更新 Requirement、本人确认任务与评论；lead 默认包含 Requirement 发布和研发动作，但团队范围更新仍必须同时具有 `update-explicit-team-task` 和 `explicit-team` scope。

写动作白名单只能收紧工作流，不能绕过 MCP 能力门禁、owner 精确匹配、dry-run、二次确认或 TAPD 权限。只读 intake、个人待办和团队盘点不受写动作白名单限制。

## 估时写回策略

解析顺序：

1. 用户本轮明确说“直接写回 / 只建议 / 不写回”。
2. `.tapd/config.json.workflow.effort_writeback`。
3. `.tapd/team.json.defaults.effort_writeback`。
4. 默认 `confirm`。

支持：

- `confirm`：输出估时和排期 dry-run，确认后写回。团队试点默认。
- `auto`：只有配置显式声明时，任务编排可在展示摘要后自动写回。
- `never`：只输出建议，不写 effort/begin/due。

兼容旧配置：仅在没有新字段时读取 `effort.auto_writeback`；`true` 映射为 `auto`，`false` 映射为 `never`。

参数优先级同配置分层。个人容量可以覆盖团队容量，但每次输出都必须显示实际采用的来源和值。

## 状态流转

团队策略缺失时默认 `never`。即使 `.tapd/team.json.defaults.status_transition=confirm`，也只能在用户明确要求流转具体工作项状态时展示 dry-run 并等待确认；任务创建、代码完成或登记工时本身均不构成状态流转授权。

## 输出要求

涉及团队策略的工作流，在结果中简短列出：

- 当前 profile 与来源。
- 任务前缀与修改范围。
- effort 写回模式与来源。
- 当前写动作是否被 profile 允许。
- 被策略跳过的对象及原因。

## 无仓库的普通需求

普通需求创建/修改无需初始化仓库。存在适用团队策略时按策略校验；没有策略时用户明确授权的本人需求操作可继续，不强迫填写 profile。团队范围、任务分配与排期仍按既有角色和字段规则。需要角色但未提供时在对话询问一次，不以 Git 初始化作为前置。
