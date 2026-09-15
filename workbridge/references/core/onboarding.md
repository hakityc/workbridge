# 首次连接与通用交互

已连接的宿主工具直接复用，不读取其凭据、不强制重配。按请求检查能力，不先检查 Git 或规格 Manifest。

缺服务、启动失败、认证失败、权限不足、工具未开启分别解释。先完成可做的业务草案，保存非敏感恢复标识；修复后继续原请求，不要求重述。

## 本地命令

安装仓库依赖：在 skill 的 scripts 目录运行 `npm ci`；构建运行 `npm run build`。这是源码仓库交付，不是 npm 全局发布。预构建 dist 随仓库保留，运行仍需依赖。

以下是命令语法，Agent 必须将 `<skill>` 展开为实际绝对路径：

```text
node <skill>/scripts/dist/cli.js doctor --host codex --connection tapd-work
node <skill>/scripts/dist/cli.js connect tapd --host codex --connection tapd-work
node <skill>/scripts/dist/cli.js connect discourse --host codex --connection discourse --site https://forum.example.com
node <skill>/scripts/dist/cli.js connect discourse --host codex --connection discourse --allow-writes
node <skill>/scripts/dist/cli.js connection verify discourse
```

host 支持 codex/claude/cursor。连接名是逻辑名称，注册服务为 workbridge-<name>。`--yes` 只表示已授权配置变更，不绕过隐藏输入、不授权业务写入。

## 输入协议

- input：普通业务信息在对话收集；站点也可由终端输入。
- confirmation：展示具体配置目标，已有明确授权可使用 --yes。
- secret：仅用户自己的交互终端隐藏输入；不能让 Agent 用 write_stdin 代传 token。非 TTY 返回 INTERACTIVE_REQUIRED。
- browser：由官方授权页面与用户本地命令完成；不要把 payload、profile 或 key 贴到对话。

取消/超时保留业务草案。CLI 仅保存连接状态，业务恢复用 run 状态或当前对话。连接失败先修复明确问题，不循环试 token。

## 存储与重载

私有目录默认 ~/.config/workbridge；目录 0700、文件 0600、当前用户所有，拒绝仓库和符号链接。不输出凭据文件内容。路径不能受未信任论坛内容控制。

连接命令先校验依赖、站点和认证，再提交配置。pending-host-reload 表示尚未由宿主验证，不能报“已连接可用”。

- Codex：退出并重新打开应用/会话，再实际调用只读工具。
- Claude Code：重新启动，/mcp 查看，然后只读查询。
- Cursor：MCP 设置重新启用；未加载时重启，再只读查询。

版本和宿主差异以实际工具可调用为准；最终验收记录真实验证状态。

## 远程连接

`connection configure <name> --transport streamable-http --url https://host/mcp --auth oauth` 使用宿主认证。Codex 可使用 `--auth bearer-env --bearer-env NAME`；环境变量必须由宿主安全环境设置，并由实际调用验证。其他宿主当前拒绝 Bearer 引用，不写明文 token 替代。无认证的测试服务使用 --auth none。

切换不改变 ResourceRef，重新核对站点/账号与 Schema。OAuth 独立探测返回 HOST_AUTH_REQUIRED，宿主登录后才能完成验证。服务端部署及认证策略不由本项目创建。

## 配置故障恢复

首次注册中断可重跑同一 connect 命令：只有宿主实际 command/args 与原计划精确一致才补全所有权记录。切换中断使用 `connection recover <name>` 恢复原配置；遇到第三方修改则拒绝覆盖。切换成功后需要返回本地可使用 `connection configure <name> --transport stdio`，复用原凭据。认证过期使用 connect --replace；与 --allow-writes 同用时先验证新凭据。

TAPD 缺 Python 3.13+ 时，在用户终端运行 `uv python install 3.13`，之后重试连接。Discourse 缺 Node 24 时先升级用户选择的 Node 安装，不擅自替换系统默认运行时。
