# 上下文与恢复

业务查询、草案和创建无需 Git。仅用户要求分支绑定/开发时使用 Git 上下文。

`context bind --input <ResourceRef JSON 文件>` 保存当前项目和分支的通用绑定到用户私有目录；冲突不覆盖。用户确认覆盖后 --replace。`context current` 只读恢复，不自动迁移或写缓存。

连接与平台必须匹配，空间/类型/ID 必须明确。当前项目+分支限定绑定，资源缓存身份包含 provider/connection/space/kind/id。

`context migrate --connection <tapd-connection>` 显式读取旧 $GIT_DIR/tapd-context 或 .tapd/context.json；旧文件不修改。缺 workspace、损坏 JSON、新配置冲突停止。现有 .flow/spec.json 不改名。

`context start --input <ResourceRef JSON> --base <已确认基线> --branch <新分支>` 复用现有 Git 模块创建分支，保存通用绑定。拒绝 dirty 工作树、已存在分支及绑定冲突；不 pull、stash、提交或删分支。用户未指定分支名时默认 codex/ 前缀。绑定失败尝试恢复原分支，保留已创建分支以便人工检查。

TAPD 旧 CLI 保留为兼容模块；新流程不调用其 start/bind/current/init 来创建旧数据。spec 命令继续复用其纯规格实现。旧用户可显式使用旧 CLI，但不双写；通用流程读取 context current 和新的项目设置，旧 .tapd/team.json 继续作为只读团队策略来源。

`run save --input <run.json>` 仅持久化必要草案和步骤结果；`run show <id>` 恢复。成功步骤不可删改，未知步骤必须远端查证。用户要求不留痕时不写任何 run 文件。run 记录不是平台事实源。
