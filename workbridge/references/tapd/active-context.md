# Active Context

`.tapd/active-context.md` 是 `tapd-context` 生成给 Agent 读取的渲染产物，不是事实源、数据库或长期存储。

使用规则：

- 读取前必须检查文件顶部 `tapd-context` 元数据里的 `branch` 是否等于当前 Git 分支。
- 分支不一致时视为 stale，不得继续使用；执行 `tapd-context sync --current-branch` 重新生成。
- 文件可以包含标题、URL、工作项 ID 和简短提示，但不得包含 token、完整 raw response、完整评论列表或敏感 header。
- TAPD 写入前必须重新通过 MCP 确认目标对象，不能只依赖本文件。

建议加入 `.gitignore`：

```gitignore
.tapd/active-context.md
```
