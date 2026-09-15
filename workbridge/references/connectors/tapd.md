# TAPD Connector

能力声明：tapd.json；当前固定 mcp-server-tapd==8.0.78，与既有回归基线一致。宿主实际工具 Schema 是最终调用契约。

## 接入

用户在 TAPD 官方个人访问令牌入口取得 token 后，在本地 connect 命令隐藏输入。入口以 https://www.tapd.cn/personal_settings/index?tab=personal_token 个人访问令牌页面为核查起点；界面若变更，通过 TAPD 的个人设置/开放平台查看，不要求用户提供密码。连接命令不直接请求业务 OpenAPI，验证调用 MCP get_user_participant_projects。

token 仅传入子进程环境 TAPD_ACCESS_TOKEN，宿主配置只引用 WorkBridge 启动器。不会把 token 展开到 codex mcp add --env 参数。

## 映射

- space → workspace_id；Requirement → stories；Task → tasks；Defect → bug。
- title → name（Bug 使用 title），父需求 → story_id；ID 在契约层为字符串，工具要求数字时先验证无精度损失。
- priority 必须先读取平台候选；使用 priority_label，不把 P0/P1 原样当作平台枚举。
- 工时单位与日期规则按既有字段指导；状态流转读取当前允许转换，不能只靠中文标签。
- 读取标题与 description，分页检查完整性，缺字段不当成空值。

平台详细规则按动作加载 ../tapd/work-item-orchestrator.md、../tapd/team-policy.md、../tapd/task-orchestrator.md、../tapd/effort-scheduler.md；这些文档是 TAPD 适配规则，不是所有平台的公共要求。公共授权和首次连接规则优先使用 ../core/execution.md 与 ../core/onboarding.md。

完整旧交付能力在 ../tapd/ 中保留单一副本，按 ../workflows/delivery.md 路由。旧开发命令仍为兼容模式，不用于通用 ResourceRef 写入。
