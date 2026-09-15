# WorkBridge 场景验收记录

验证日期：2026-09-15。实施环境：macOS，系统 Node 22.22.2；另使用隔离 Node 24.0.0 补测，未替换系统 Node。

## 实测结果

| 检查 | 结果 | 证据与边界 |
|---|---|---|
| 重构前基线 | 通过 | 原 TAPD quick_validate 在迁移前通过 |
| WorkBridge 完整校验 | 通过 | `python3 workbridge/scripts/quick_validate.py`，含 src/dist 一致性 |
| 原 Git/context/规格 Node 回归 | 20/20 通过 | `workbridge/scripts/tapd-context/test/cli.test.mjs` |
| 新 Node 契约与集成测试 | 14/14 通过 | `workbridge/scripts/test/core.test.mjs` |
| Python 安全与终端测试，Node 22 | 18 通过，2 跳过 | 共 20 个；两项 Discourse 要求 Node 24 |
| 临时 Node 24 终端补测 | 9/9 通过 | `tests/test_workbridge_terminal.py`；覆盖前述两项跳过，假论坛/假宿主 |
| 官方 skill 格式校验 | 两入口通过 | workbridge 与 tapd；使用隔离 PyYAML，不改项目依赖 |
| 独立 Agent 前测 | 已执行、问题已修复 | 三个业务场景静态前测，以及连接失败恢复的代码前测；不是完整真实 Agent 业务 E2E |
| 当前宿主真实 TAPD 读取 | 成功 | get_user_participant_projects 返回 status=1，未记录项目名称、token 或正文 |
| 真实业务写入 | 未执行 | 未指定测试项目/主题，未创建需求、帖子、评论或其他业务资源 |

## 场景覆盖

“自动化通过”仅指下面列出的实际断言，不代表所有真实宿主组合已经完成认证。

| 场景组 | 已验证 | 尚未验证 |
|---|---|---|
| 首次使用 | 假 TAPD 首次连接、非交互拒绝、普通需求无需 Git 的独立前测 | 所有安装缺失组合的真实用户旅程 |
| 运行环境 | Node 22 拒绝本地 Discourse；Node 24 补测；uv/宿主前置检查代码 | 干净 Linux 系统安装 uv/Python/宿主全过程 |
| 安全输入 | 真 PTY 中隐藏 token、Ctrl-C、错误 token、非 TTY、禁用 token 参数 | 五分钟交互超时的实时时长测试、操作系统强杀进程 |
| 凭据存储 | 0600、损坏文件不覆盖、符号链接/仓库拒绝、错误重授权保留旧凭据 | 文件系统断电与硬件故障 |
| 认证 | 假 token 拒绝与不泄露；Discourse 官方包接口映射、伪浏览器完成/取消 | 真实 Discourse 用户授权、过期、撤销和私人主题权限 |
| 宿主配置 | Codex/Claude 假 CLI；Cursor 临时 JSON；未知字段保留、冲突拒绝、仅移除自有注册 | 三宿主在 macOS/Linux 的真实添加与重载全矩阵 |
| 注册恢复 | pending 指纹恢复、切换回读失败恢复原注册、成功本地↔远程往返 | 宿主崩溃及实际远程 OAuth 错误后的人工恢复 |
| 能力 | 缺工具、MCP 错误、业务 status 错误、超时、分页 | 各平台所有权限/工具集组合的真实探测 |
| 路由 | 显式连接优先、歧义拒绝、平台/空间/类型/连接隔离 | 企业多租户真实账号矩阵 |
| 业务回归 | 原测试全部通过，旧说明保留单一副本；Manifest 和普通需求边界前测 | TAPD 全部业务动作真实写回 |
| 跨平台 | 仅草案不强制目标接入、来源与目标独立、unknown 回复先查证的独立前测 | 真实讨论→需求→回帖端到端 |
| 写入恢复 | run 成功步骤不可重写、unknown 单独记录；无重复创建规则前测 | 远端写入已发生但响应丢失的生产故障注入 |
| 传输 | SDK stdio 与 loopback Streamable HTTP 读取同类能力，分页、原资源引用保持 | 公网 TLS/OAuth/Bearer 与真实远端服务 |
| 迁移 | 旧 context 显式读取、重复迁移、通用分支不写 .tapd、dirty 拒绝 | 每个历史版本与全部用户缓存布局 |
| 扩展 | 测试专用连接器无需修改公共路由 | 新生产平台，未创建占位实现 |

## 本轮发现并修复

- 普通需求被旧规格准入说明误阻塞：限定 Manifest 仅用于正式规格流程。
- 只生成需求草案却要求目标 TAPD 接入：在源讨论整理完成处结束。
- 宿主添加成功、回读失败后不能恢复：精确比对预期注册后补全指纹，拒绝未知配置。
- 远程切换产生本地/宿主分叉：保存切换记录，失败恢复；中断后提供 recover。
- 重新授权与开启 Discourse 写入同用时先验证过期凭据：改为先验证新凭据。
- 旧手写 MCP 探测未统一协议/分页处理：改用固定版本官方 SDK。

## 复现

从仓库根目录运行：

```sh
npm --prefix workbridge/scripts ci
npm --prefix workbridge/scripts/tapd-context ci
python3 workbridge/scripts/quick_validate.py
npm exec --yes --registry=https://registry.npmjs.org --package=node@24.0.0 -- python3 -m unittest discover -s tests -p test_workbridge_terminal.py
```

最后一条仅为固定测试运行时，不是推荐的生产 Node 版本；生产使用维护中的 Node 24 补丁版本。测试需要 PTY 和 loopback 监听权限；不需要真实 token。真实 MCP 与宿主验证需单独进行，不能把本表的模拟结果标为生产通过。

未全局安装 WorkBridge，未修改用户真实宿主配置或凭据，未提交、推送或发布。
