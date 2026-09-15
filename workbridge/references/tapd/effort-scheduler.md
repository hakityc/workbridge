# TAPD 估时与排期（AI 加速版）

这是独立的 `task.schedule` 操作；任务字段和日期缺失 Gate 见 `references/tapd/work-item-orchestrator.md`。

## 目标

基于 TAPD 需求/任务与“我”的现有任务负载，输出一份**不夸张、可解释、可调整**的估时与排期建议；任务编排串联调用时默认确认后再写回。

写回策略由 `references/tapd/team-policy.md` 决定，团队试点默认 `confirm`：

- 从 `references/tapd/task-orchestrator.md` 串联调用时：默认展示 owner=我的任务的 effort/begin/due dry-run，确认后写回。
- 单独被用户调用且用户未明确说“写回”时：先 dry-run，询问确认后再写回。
- 用户说“只看看 / 不要写回 / 只估时不写回 / 只拆任务不写工时”时：仅输出建议，不写 TAPD。

owner 判断必须复用 `references/tapd/safety-policy.md` 的分隔符精确匹配，禁止 substring。

## 默认参数（可调）

- `capacity_per_week_hours = 30`（默认 30h/周）
- `work_days_per_week = 5`
- `capacity_per_workday_hours = capacity_per_week_hours / work_days_per_week`（默认 6h/工作日）
- `allow_weekend = false`
- `wip_limit = 2`（同时进行任务不超过 2 个）
- `effort_writeback = confirm`（`auto` 必须由团队或个人配置显式开启）

### AI 加速系数（可调，避免写死）

估时按“分段”而不是整体打折：

- `ai_coding_factor = 0.45`（实现/编码段：传统工时 × 0.45）
- `integration_factor = 0.85`（联调/回归段：传统工时 × 0.85）
- `planning_factor = 0.80`（需求对齐/拆解段：传统工时 × 0.80）
- `buffer_percent = 0.20`（默认 20% 风险缓冲）

> 说明：这组默认值偏保守，目标是“不夸张”。参数按 `team-policy.md` 的配置优先级合并；缺省字段继续使用上面的默认值。

不要把所有任务机械乘以同一个 AI 系数：代码落点清楚、接口稳定、重复性高时可用 `0.40~0.50`；新接口、数据变更或跨仓库联调时实现段用 `0.60~0.80` 并提高缓冲；未知依赖或验收口径不清时优先提高 integration/buffer，而不是压低 plan。

示例：

```json
{
  "effort": {
    "capacity_per_week_hours": 30,
    "wip_limit": 2,
    "ai_coding_factor": 0.45,
    "integration_factor": 0.85,
    "planning_factor": 0.8,
    "buffer_percent": 0.2,
    "auto_writeback": false
  }
}
```

## 任务类型估时基线模板

| 类型 | plan | implement | integration | 默认缓冲 | 备注 |
|---|---:|---:|---:|---:|---|
| 纯 UI 改版 | 0.5~1h | 4~8h | 1~2h | 20% | 无新 API |
| 组件/弹窗 | 0.5~1h | 3~6h | 1~2h | 20% | |
| RTC/音视频 | 1~2h | 12~20h | 4~8h | 30~50% | 联调重 |
| 前后端联调 | 1h | 4~8h | 4~8h | 30% | 接口未定上调 |
| i18n/样式收尾 | 0.5h | 1~3h | 0.5~1h | 10% | |

## 输入

- Story 一键复制 / story_id / 链接  
- （可选）新任务列表（若用户要对“将创建的新任务”排期）  
- （可选）用户额外约束：必须完成日期、不可延期事项  
- （可选）调用来源：`task-orchestrator` 串联调用或用户单独调用  
- （必须）写回日期：用户确认的开始/结束工作日；缺失时只输出拆分和估时草案，不写回。

## 输出格式（必须）

按下面结构输出（不要自由发挥）：

1) **参数摘要**：capacity/WIP/系数/缓冲  
2) **当前负载概览**：owner=我 的 open/progressing tasks 数量与最近 due  
3) **新任务估时**：每条任务（plan/implement/integration/buffer/total）  
4) **建议排期**：每条任务 begin/due（按工作日）  
5) **冲突/风险提示**：明确哪些 due 会被挤压，给出 2~3 个策略选项  
6) **写回结果**：每条任务写回状态、跳过原因、回读校验结果  
## 强制步骤

1. **确保 MCP 可用**  
   - 若不可用，先执行 `references/tapd/mcp-bootstrap.md`  
2. **确认“我”是谁（强制）**  
   - 复用 `references/tapd/task-orchestrator.md` 的“确认我是谁”规则  
3. **读取估时参数（强制）**  
   - 按 `team-policy.md` 合并 `.tapd/team.json`、`.tapd/config.json` 和本轮输入；缺省值使用本文“默认参数”。
   - 用户本轮显式输入的容量、WIP、截止日期、缓冲或 opt-out 优先级最高。  
4. **拉取我的现有任务负载（强制）**  
   - 用 `get_stories_or_tasks(entity_type='tasks')` 查询候选任务，再按共享 owner token 规则精确过滤“我”的任务  
   - 过滤状态：`open` / `progressing`  
   - fields 至少包含：`id,name,status,priority_label,owner,created,modified,begin,due,effort,story_id`
5. **估时（强制，分段）**  
   - 对每条新任务先给“传统工时基线”（可用经验/模板），再乘以系数：  
     - plan  
     - implement（受 ai_coding_factor 影响最大）  
     - integration（受 integration_factor 影响，且若依赖后端/权限则提高缓冲）  
   - 总工时 = (plan×planning_factor + implement×ai_coding_factor + integration×integration_factor) × (1+buffer_percent)  
   - 结果向上取整到 0.5h；同时展示 h 和按 6h/工作日换算的 d，写回使用 Provider/团队已约定的单位，不猜单位。
6. **排期（强制）**  
   - 把每周 `capacity_per_week_hours` 按工作日切片  
   - WIP 限制：同一时间最多并行 `wip_limit` 个任务  
   - 优先级顺序默认：  
     - 有 due 的先排  
     - progressing 优先于 open  
   - 新任务按“依赖链”顺序排（若来自 story/tasks）
   - 若用户未提供日期窗口，先询问开始日期和结束日期；不得用 today、Story due 或最近工作日静默补齐。
7. **写回规则（policy-controlled）**
   - `confirm`：展示 dry-run 并等待确认；这是缺少配置时的默认值。
   - `auto`：仅在团队或个人配置显式声明时，展示摘要后写回。
   - `never`：只输出建议。
   - 单独调用时：除非用户明确授权“写回”，否则展示 dry-run 后询问确认。  
   - 默认只写回 owner=我的任务；团队范围仅按 `team-policy.md` 的 `explicit-team` 条件处理，其他非本人任务必须跳过并说明。
   - 写回前必须展示 dry-run 清单；写回后必须回读校验 effort/begin/due。  
   - 缺少 `update_story_or_task` 时只输出建议，不执行未文档化 fallback  
   - 不自动修改 Story/Task 状态，不自动登记工时，不自动写 Story 评论。  

## 风险缓冲规则（建议）

遇到下列任一情况，`buffer_percent` 建议上调到 30%~50%：

- 后端接口/字段未定或需联调  
- 需要额外权限/审批  
- 原型不完整/验收口径不清  
- 需要灰度/多环境验证  
