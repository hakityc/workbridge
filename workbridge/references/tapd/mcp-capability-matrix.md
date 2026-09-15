# tapd-mcp Capability Matrix

## 探测方法

1. 用只读 `get_user_participant_projects` 或 Story/Task 查询确认 MCP 服务在线。
2. 检查当前工具列表是否包含目标 workflow 的具体工具。
3. 不通过调用写工具来“探测”能力。
4. 工具名可能随 MCP 版本变化；按当前暴露 schema 判断，不假定存在。

## Runtime Matrix

| Workflow | 必需能力 | 可选/待探测能力 | 缺失处理 |
|---|---|---|---|
| Story/Task intake | `get_stories_or_tasks` | `get_image`, `get_entity_attachments` | 缺读取工具则 bootstrap/升级后停止；缺图片工具则列出未读取原型 |
| Bug intake | `get_bug` | `get_entity_attachments`, `get_comments`, `get_entity_relations` | 缺 `get_bug` 则只保留本地绑定并要求修复 MCP；可选信息缺失时列出 gap |
| Bug 创建/更新 | `create_bug` / `update_bug` | `get_bug` 用于回读 | 缺写工具则只输出 dry-run，不直接调用 OpenAPI |
| 产品规格首次发布 | `get_stories_or_tasks`, `create_story_or_task`（`entity_type='stories'`） | 无 | 先按稳定标题与受管标记恢复映射；缺读取或创建工具则只输出草案 |
| 产品规格后续发布 | `get_stories_or_tasks`, `update_story_or_task` | `create_comments`, `get_comments` | 只替换 Flow 受管区块；缺更新工具则停止远端同步 |
| 产品评审 Gate | `get_stories_or_tasks` | `create_comments`, `get_comments` | 可生成评审包；缺评论能力时输出可复制结论，不声称已通知 |
| Task 创建 | `get_stories_or_tasks`, `create_story_or_task` | 无 | 缺创建工具则只输出 dry-run |
| Task 更新 | `get_stories_or_tasks`, `update_story_or_task` | 无 | 缺更新工具则只输出 dry-run |
| 编码前审核 | 对应 Story/Task intake 能力 | `create_comments`, `get_comments` | 仍可产出审核清单；用户确认后缺评论写入能力则只输出评论草案 |
| Plan | 对应 Story/Task/Bug intake 能力 | `create_comments` | 仍可产出计划；不能同步评论时明确说明 |
| 评论同步 | `create_comments` | `get_comments` | 缺创建工具则不写；缺读取工具可依据成功返回说明无法列表回读 |
| Tcase 创建 | `create_or_update_tcases` 或 `create_tcases_batch` | `get_tcases`, `entity_relations`, `get_entity_relations` | 能创建就创建；缺关联工具时说明未关联 Story |
| Schedule | `get_stories_or_tasks` | `update_story_or_task` | 默认只建议；明确写回但缺更新工具时停止 |
| 开发执行 | 对应 Story/Task/Bug intake 能力 | `create_comments` | 本地编码与测试可继续；远端同步按能力降级 |
| 开发收尾 | 无，本地验证可执行 | `get_commit_msg`, `get_timesheets`, `add_timesheets`, `update_timesheets`, `create_comments` | 分别生成提交/工时/评论草案，不阻塞本地收尾 |
| 日报/站会简报 | `get_stories_or_tasks` | `get_bug`, `get_comments`, `get_timesheets`, `get_iterations`, `get_workflows_last_steps` | 缺任务读取则停止；缺可选数据则生成短 gap |
| 今日待办规划（当前迭代） | `get_stories_or_tasks`, `get_iterations` | `get_bug`, `get_timesheets`, `get_workflows_last_steps` | 缺迭代读取时仅接受用户显式 iteration_id/name 或从本人任务唯一推断；不能退化为只筛 due=今天 |
| 团队迭代盘点 | `get_stories_or_tasks`, `get_iterations` | `get_bug`, `get_comments`, `get_workflows_last_steps` | 只读拉取当前迭代任务并按 owner 分组；缺阻塞证据时不得臆造 |
兼容基线 [`mcp-server-tapd==8.0.78`](https://pypi.org/project/mcp-server-tapd/8.0.78/) 的发布包源码已注册 `get_bug`、`create_bug`、`update_bug`、`get_comments`、`get_entity_relations` 和 `entity_relations`。运行时仍以实际暴露的工具为准，避免旧版本或宿主工具过滤造成误判。

## Current user

`mcp-server-tapd` 使用个人 token 时会在服务内部调用 `users/info` 识别用户，但当前工具列表不保证把 nick 单独返回给调用方。需要 owner 精确匹配时，按以下顺序获取：

1. 本轮 Context JSON 的 `user_nick`。
2. 当前 context 或 `.tapd/config.json` 的 `user_nick`。
3. 使用 MCP 返回的当前身份；没有对应读取能力时询问用户，不读取 token。
4. 询问用户一次，并用 `tapd-context configure --user` 保存到本地配置。

不得假设 Agent 能读取 MCP 子进程环境变量。

## Missing capability

- 先检查 MCP 是否为兼容基线版本，并按 `mcp-bootstrap.md` reload/restart 后重新探测。
- 必需工具仍缺失时停止远端步骤并列出缺少的工具。
- 不从 skill 直接读取 token，不绕过 MCP 调用 OpenAPI。

## 回读语义

- 评论：`create_comments` 返回明确成功但没有 `get_comments` 时，输出“写入成功，但无法评论列表回读”。
- 用例：创建与关联是两个独立结果；关联能力缺失不回滚已创建用例。
- 任何回读失败都不得把写入描述为已确认。
