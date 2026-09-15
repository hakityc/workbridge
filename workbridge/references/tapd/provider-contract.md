# Flow Work Item Provider Contract

Flow 核心工作流只使用通用实体和能力，不直接依赖某个平台字段：

- `Requirement`：规格发布与评审的协作载体。
- `Task`：前端、后端、质量和产品执行单元。
- `Defect`：验证失败与回归闭环。
- `TestCase`：与 `AC-*` 对应的可执行验收描述。
- `Comment`：进度、差异、评审结论和证据摘要。

## Adapter 能力

所有实体写入复用同一生命周期：`resolve → read → normalize → validate → dry-run → confirm → write → readback`。Requirement 与 Task 的操作可以独立执行；Provider Adapter 只负责把规范字段和能力映射到平台，不负责替 Flow 自动串联后续操作。

Provider Adapter 按运行时声明并映射以下能力：

| 通用能力 | 输入/结果语义 | TAPD Provider 映射 |
|---|---|---|
| `requirement.read` | 读取完整标题、描述、ID 和 URL | `get_stories_or_tasks(entity_type='stories')` |
| `requirement.create` | 原子创建标题与受管描述，返回 ID/URL | `create_story_or_task(entity_type='stories')` |
| `requirement.update` | 更新指定 Requirement 并可回读 | `update_story_or_task` |
| `task.read/create/update` | 读取、创建和更新执行单元 | Story/Task MCP 工具 |
| `defect.read/create/update` | 读取、创建和更新缺陷 | Bug MCP 工具 |
| `testcase.create/link/read` | 创建、关联并读取 Case | TCase 与 relation MCP 工具 |
| `comment.create/read` | 写入并回读协作记录 | Comment MCP 工具 |

规范字段至少包括：Requirement 的 `title/description/priority/source`，Task 的 `story_id/name/description/owner/priority/effort/begin/due`。平台不支持某字段时必须在 dry-run 标记 gap；不得以省略字段或空值伪装为成功写入。

每个 Adapter 还必须提供：

- `provider` 稳定标识、space 标识和外部 ID/URL 规范。
- 能力探测，不以失败写入充当探测。
- 字段映射与安全降级说明。
- 写后回读语义；无法回读时不得声称已确认。

核心 Manifest 只保存通用 `provider + space_id + entity_type + external_id + url` 映射。TAPD URL、Story 字段名和 MCP 工具名只出现在 TAPD Provider 能力矩阵与 Adapter 执行段中。未实现的 Provider 可以生成通用发布草案，但不得执行远端写入。
