# WorkBridge

跨 TAPD 与 Discourse 的业务编排 skill，附带安全连接 CLI。Agent 负责业务流程，CLI 负责凭据输入、宿主配置、MCP 探测和本地恢复；不运行额外的业务网关。

## 支持什么

- TAPD 需求、任务、缺陷、评论、用例、排期，以及既有研发交付流程。
- Discourse 讨论搜索、阅读、创建、回复与编辑。
- 讨论转需求、进展发布；只有明确授权才创建资源或发送内容。
- 本地 stdio / 远程 Streamable HTTP，通过稳定连接名保持资源引用。
- macOS/Linux 的 Codex、Claude Code、Cursor 配置适配。真实宿主验证范围见验收表。

## 从源码安装

在仓库根目录执行：

```sh
npm --prefix workbridge/scripts ci
npm --prefix workbridge/scripts run build
mkdir -p ~/.agents/skills
ln -s "$PWD/workbridge" ~/.agents/skills/workbridge
```

如果链接已存在，先检查是否指向本仓库，不能覆盖未知安装。

运行需要 Node >=22；本地 Discourse 另需 Node >=24。TAPD 需要 uv/uvx 与 Python >=3.13；CLI 在获取凭据前检查前置环境。依赖和服务版本固定，不自动升级已有 MCP。

## 首次使用

直接告诉 Agent “帮我创建需求”或“整理这个 Discourse 讨论”。已有宿主 MCP 会直接复用；缺失时 Agent 保留草案并只引导当前必需连接。普通需求无需 Git 仓库。

需要首次连接时，在**自己的终端**执行以下命令；不要把 token 发到聊天：

```sh
node "$PWD/workbridge/scripts/dist/cli.js" connect tapd --host codex --connection tapd-work
node "$PWD/workbridge/scripts/dist/cli.js" connect discourse --host codex --connection discourse --site https://forum.example.com
```

将站点替换为实际 Discourse 站点地址，host 可选 codex/claude/cursor。Agent 给出的命令必须展开成实际绝对路径。

TAPD 的[个人访问令牌入口](https://www.tapd.cn/personal_settings/index?tab=personal_token)只显示一次新 token。CLI 隐藏输入、MCP 只读验证后保存；不把凭据展开进命令参数或宿主配置。

Discourse 使用官方浏览器授权；也可 `--profile /absolute/private/profile.json` 引用已有凭据。profile 文件需要 0600，父目录需要 0700，路径不得经过符号链接或位于 Git 仓库。默认只读；启用写工具使用相同 connect 命令追加 `--allow-writes`，不代表授权所有发帖操作。

配置完成后重启对应宿主，Agent 实际只读调用成功才视为就绪。CLI 返回的 `hostVerified: false` 不应被隐藏。

## 修复与迁移

```sh
node "$PWD/workbridge/scripts/dist/cli.js" doctor --host codex --connection tapd-work
node "$PWD/workbridge/scripts/dist/cli.js" connect tapd --host codex --connection tapd-work --replace
node "$PWD/workbridge/scripts/dist/cli.js" connection configure tapd-work --transport streamable-http --url https://mcp.example.com/mcp --auth oauth
node "$PWD/workbridge/scripts/dist/cli.js" connection configure tapd-work --transport stdio
node "$PWD/workbridge/scripts/dist/cli.js" connection recover tapd-work
node "$PWD/workbridge/scripts/dist/cli.js" disconnect tapd-work
```

`--replace` 重新授权，验证失败保留旧凭据。`recover` 仅恢复有未完成切换记录的连接。远程 OAuth 由宿主完成；Codex 也支持 `--auth bearer-env --bearer-env VARIABLE_NAME`，变量必须在宿主安全环境中设置。其他宿主未实现安全 Bearer 引用时明确拒绝，不写明文作为替代。

断开不会撤销远端 key 或删除业务资源。外部 Discourse profile 不删除；WorkBridge 自己创建的本地凭据会随断开移除。

新分支绑定使用 `context bind/start/current`；旧绑定通过 `context migrate --connection <name>` 显式导入，旧文件不改写。`.flow/spec.json` 保留原规格事实源。详见 [上下文规则](workbridge/references/core/context.md)。

## 架构与验证

入口 → Workflow → Capability → Connector → 宿主 MCP。平台细节仅在连接器及 TAPD 兼容模块中；CLI 的 MCP 客户端只用于只读探测，不执行业务写入。

- [WorkBridge skill](workbridge/SKILL.md)
- [安全交互与首次连接](workbridge/references/core/onboarding.md)
- [公共执行契约](workbridge/references/core/execution.md)
- [场景验收记录](docs/workbridge-validation.md)
- [TAPD 参考指南](docs/tapd-legacy-guide.md)

完整验证：

```sh
npm --prefix workbridge/scripts/tapd-context ci
python3 workbridge/scripts/quick_validate.py
```

测试使用临时目录、假凭据、伪宿主和 loopback MCP，不需要生产 token。TCP/PTY 受限的执行环境需允许本机测试端口和终端。真实 MCP/宿主/业务写入的验证单独记录，不能用模拟结果替代。

本项目不包含 Composio SDK、远程部署、自动同步或其他平台占位适配器；扩展时新增能力映射与按需指导，不重写现有流程。
