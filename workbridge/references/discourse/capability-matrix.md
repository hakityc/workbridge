# Discourse 能力矩阵

运行时工具 schema 是唯一调用契约。先做一个最小只读 probe；缺失目标工具时说明所需 toolset、认证或站点权限，重载后再探测，不用写工具试探。

| 用户目标 | 优先 toolset | 典型能力 | 写入前置 |
|---|---|---|---|
| 找历史讨论、复现反馈、汇总声音 | `search,topics` | topic/post 搜索、主题/帖子/精确帖流读取 | 无 |
| 发主题、回复、改帖、查看作者活动 | `topics,users` | topic/post/user 读写 | `--allow_writes` + 目标站点认证 + 本轮确认 |
| 私信或群组私信 | `private_messages` | 列表、读取、创建、回复、邀请成员 | 认证；写入另需确认 |
| 暂存草稿、上传附件 | `drafts,uploads` | 草稿读写、上传 | 写入确认；上传还需受限本地目录 |
| 支持队列、活跃度、社区洞察 | `activity,analytics,ai_insights` | 时间线、回复链、报告、Solved 面板、AI 摘要 | staff/插件能力以站点回读为准 |
| 类目、群组、标签组 | `administration,groups,tag_groups` | 目录、成员/权限、生命周期 | 明确对象级确认；删除不能批量 |
| 审核、举报与用户处置 | `moderation` | review queue、修订、单条已预检动作 | staff 权限 + 单对象确认 |
| 站点设置、Webhook、主题 | `site_settings,webhooks,themes` | 读取、单项配置/回调/主题变更 | admin 权限 + 高风险 dry-run + 回读 |
| Data Explorer、自动化工作流 | `data_explorer,workflows` | 查询、工作流草案/执行 | admin 权限；执行和变更分开确认 |
| AI agent、AI custom tool、AI feature | `ai_agents,ai_custom_tools,ai_features` | AI 配置与生命周期 | admin 权限；测试自定义工具也可能产生外部副作用 |

`all` 是完整目录的运维选择，不是默认值。选择 toolset 不绕过 Discourse 的 Guardian、staff、scoped key、插件或功能开关；插件相关 404 统一记为 `capability_or_resource_unavailable`，不猜测原因。

读取列表、搜索或目录时保留 `has_more`、`complete`、`truncated`、分页和权限缺口。没有完整性证据时只能报告“已读取范围”，不能报告“全部”。
