# Discourse Connector / WiseFlow connection

来源：https://github.com/discourse/discourse-mcp 。实际读取 @discourse/mcp@0.3.1 发布包核对工具名。固定版本 0.3.1，本地要求 Node >=24；官方 generator 负责 device/legacy 用户授权。WiseFlow 是站点连接名，不是新的 Provider。

| 能力 | MCP 工具 | 关键参数/回读 |
|---|---|---|
| discussion.search | discourse_search | query, max_results；检查 meta.has_more |
| discussion.topic.read | discourse_read_topic | topic_id, post_limit, start_post_number |
| discussion.post.read | discourse_read_post | post_id；检查 truncated |
| discussion.topic.create | discourse_create_topic | title, raw, category_id, tags；返回 topic_id 与首帖 id，分别使用正确 ID |
| discussion.post.create | discourse_create_post | topic_id, raw；返回 post id 后读帖子 |
| discussion.post.update | discourse_update_post | post_id, raw, edit_reason；更新前读取完整旧文，再回读 |

raw 最长 30000 字符，限制以运行时 schema 为准。topic_id 与 post_id 不混用；生成外链以确认的站点和返回 topic/slug 为准，不拼接未经验证的目标。

公开搜索成功不证明私人内容访问权限。业务对象应按用户授权读取；写入工具存在也不证明目标可写。User API Key 不支持冒充其他作者，默认不传 author_username。

默认只读；--allow-writes 是服务能力开关，不代表 Agent 可以自行发帖。403 保留草案；429 遵守等待；404 不一概断言“未安装插件”。默认使用 discourse_api_only 避免依赖 Discourse AI 工具。

既有 profile 可用 --profile 引用；必须在仓库外、无符号链接、权限 0600。官方 generator 输出留在用户终端，profile 不回传给 Agent。
