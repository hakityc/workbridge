---
name: workbridge
description: 跨平台处理需求、任务、讨论、进展和研发交付；按需连接业务系统并恢复未完成工作。用于平台业务操作及明确的跨平台协作，不用于无关的一般编码或聊天。
---

# WorkBridge

CLI 需要 Node.js 22+；本地 Discourse 需要 Node.js 24+。MCP 业务调用由宿主提供。

先读取 `references/core/execution.md`。业务流程只表达能力；实际工具与字段来自选定连接器。不要把论坛主题当需求，不自动换账号或平台。

## 按需路由

- 首次使用、连接缺失、认证失败：`references/core/onboarding.md`。保留原请求，只询问缺失的一步。不先要求 Git 初始化。
- 读取、创建、修改需求/任务/缺陷：`references/workflows/workitems.md`。
- 阅读、整理、创建、回复、编辑讨论：`references/workflows/discussion.md`。
- 讨论转需求、进展发布：`references/workflows/cross-platform.md`。
- 产品规格、评审、开发、测试、收尾、日报：`references/workflows/delivery.md`。
- 分支绑定与旧数据迁移：`references/core/context.md`；只有开发绑定需要 Git。

按目标加载一个连接器：TAPD → `references/connectors/tapd.md`；Discourse → `references/connectors/discourse.md`。不要一次加载所有工具 Schema 或所有平台指导。

已有可用宿主 MCP 直接复用，不要求托管到 WorkBridge。没有匹配工具时先诊断，不绕过 MCP 请求业务 API。工具发现不证明业务语义或写权限。

脚本入口是本 skill 的 `scripts/dist/cli.js`。交给用户的命令必须展开为真实绝对路径并正确 shell 引用；不得输出未安装的 `workbridge` 命令。依赖安装见 `references/core/onboarding.md`。

Skill 约束 Agent 的业务执行，宿主与平台强制执行权限；本项目没有统一执行网关。未经用户要求，不启用自动同步、通知或后台任务。
