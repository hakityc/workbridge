# 上下文兼容路由

新流程执行 `../core/context.md`。不得用旧 CLI 创建新的 .tapd 绑定。显式 TAPD URL 解析可复用 scripts/tapd-context 中的解析工具，但转换为通用 ResourceRef 后调用 WorkBridge context 命令。缺少 Git 不阻断普通需求业务。旧 CLI 仅为手动兼容接口。
