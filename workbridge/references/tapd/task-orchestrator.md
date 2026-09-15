# TAPD 任务编排（按团队 Profile 创建 / 回填）

公共字段、复杂度拆分、统一写入管道和日期询问 Gate 见 `references/tapd/work-item-orchestrator.md`。本文件只保留 Task 专属编排。

## 前置

- 必须先通过 MCP 探测  
  - 若不可用，先走 `references/tapd/mcp-bootstrap.md`  
- 按 `references/tapd/mcp-capability-matrix.md` 检查读取和目标 create/update 工具。  
- 若要“基于需求拆任务”，必须先走 `references/tapd/intake-gate.md`  
- 所有修改遵守 `references/tapd/safety-policy.md`。  
- 先读取 `references/tapd/work-item-orchestrator.md` 和 `references/tapd/team-policy.md`，解析当前 profile、任务前缀、修改范围、写动作权限和 effort 写回模式。

## 创建任务（Story → tasks）

1. 读取 intake 输出：Story 约束、原型、代码落点初筛和已有 tasks 覆盖情况。
2. **确认“我”是谁（强制）**：  
   - 优先使用用户输入中的 `当前用户：<nick>`  
   - 其次使用当前 context 或 `.tapd/config.json` 中的 `user_nick`
   - 使用 MCP 返回的当前身份；缺失时询问用户，不运行凭据读取脚本
   - MCP server 会用 token 在内部识别用户，但当前工具列表不保证暴露 nick；不得假装能从不可见的 MCP 环境变量读取
   - 若仍为空：询问一次 TAPD nick；用户确认后可执行 `tapd-context configure --user "<nick>"`，避免后续重复询问
3. **确认当前 profile（强制）**：按 `team-policy.md` 解析；仍为空时询问一次，并可执行 `tapd-context configure --profile <profile>` 保存。根据 profile 和团队策略取得任务前缀。
4. 按公共拆分规则结合需求、原型、现有代码和 tasks 形成可独立验收的切片；先去重，再按当前 profile 生成任务。任务数量不是固定配额。
5. **字段检查（强制）**：每条任务必须有 owner、priority、begin、due 的值或明确阻塞原因；effort 要有估时值，或用户明确选择“不写工时”。日期缺失时主动询问，不能带空日期写回。
6. **Dry-run（强制）**：先输出 profile、前缀、修改范围及将创建的任务列表（name/owner/priority/范围摘要/effort 预估值/begin/due）。用户本轮未明确授权创建时必须等待确认；已明确要求直接创建时，展示摘要后继续。
7. 创建 tasks（强制补 owner）：
   - 当前 profile 必须允许 `create-task`；否则只输出任务草案和策略跳过原因。
   - 每条 task 使用解析出的 profile 前缀，默认 `owner=<我的nick>;`（除非用户明确指定其它 owner，且策略允许）
   - 调用 `create_story_or_task(workspace_id, name, { entity_type: 'tasks', story_id, owner, priority, begin, due, description, ... })`；effort 只有排期写回获准时提交。
8. **回读校验（强制）**：创建后再拉取一次 tasks，确认 ID/owner/description/priority/begin/due 写入成功；effort 只有在排期操作获确认后写入。
9. **估时与策略化写回**（仅用户要求排期，或本轮明确同意串联 G 时）：
   - 读取并执行 `references/tapd/effort-scheduler.md` 的估时、排期和写回规则；不重复 intake。  
   - 输入为刚创建/更新的同 profile 任务列表、当前用户 nick、Story 约束和本轮已确认的工作日/截止日期约束。
   - Dry-run 输出每条任务的 `plan / implement / integration / buffer / total / begin / due`。  
   - `confirm` 模式等待确认；`auto` 仅在配置显式声明时展示摘要后继续；`never` 只输出建议。默认不得自动写回。
   - 写回还要求当前 profile 允许 `write-effort`；默认只对 owner token 精确匹配“我”的任务写回；`explicit-team` 按 `team-policy.md` 的四项条件处理。
   - 写回后重新拉取 tasks，校验 effort/begin/due。  
   - Story 评论中的“估时摘要”默认不写；仅当用户明确要求同步评论时，才调用 `create_comments` 写入摘要。  
10. 返回每条 task 的可点击链接，并输出 priority/effort/begin/due 汇总和 Story 同 profile 任务总工时；未排期时逐条标记“等待日期/仅建议”。

## 批量更新任务字段

1. **确认“我”是谁（强制）**：同“创建任务”第 2 步。  
2. 拉取该 Story 下 tasks：`get_stories_or_tasks(workspace_id, { entity_type: 'tasks', story_id, ... })`。  
3. 只筛选当前 profile 前缀任务；用户明确要求多个 profile 时逐组展示，不混算。允许更新的字段以用户本轮点名为准：`owner`、`priority`、`effort`、`begin`、`due`、`description`；未点名字段不动。
4. **安全过滤（强制）**：  
   - 本人更新需要 `update-self-task`；团队范围更新需要 `update-explicit-team-task`。
   - 按 `safety-policy.md` 的 owner 分隔符精确匹配规则判断本人。  
   - 默认仅允许对精确匹配当前 nick 的任务执行修改。
   - 当前 profile 被团队策略授权 `explicit-team` 时，只允许修改用户本轮明确点名且 owner 精确匹配的成员任务。
   - 对不在解析后修改范围内的任务：只展示，不修改，并注明“已跳过（策略未授权）”。
5. **Dry-run（强制）**：先展示“将被修改”的候选清单（id/name/owner/字段/旧值→新值）；未授权时等待确认。`effort` 变化不自动改日期，日期变化不自动改 effort；日期为空时先走日期询问 Gate。
6. 执行批量更新：`update_story_or_task(workspace_id, { entity_type: 'tasks', id, ... })`。  
7. **回读校验（强制）**：更新后重新拉取并对比关键字段，确认写入成功。  

## 收尾输出（强制）

任务编排完成后必须输出：

- 任务链接表：id / name / owner / link。
- 工时排期表：id / priority / effort / begin / due / 写回状态。
- Story 总工时：按 profile 分组；个人视角只汇总 owner 精确匹配“我”的任务，团队授权视角单独展示明确目标成员的小计。
- 跳过清单：策略未授权、用户选择只建议、缺少 update 能力或回读失败的任务必须逐条说明。

## 安全护栏

- **创建任务默认 owner=我**：除非用户明确指定其它 owner；若不知道“我”是谁，必须主动询问。  
- **任务 priority/effort/begin/due 不留空写回**：priority 优先继承父需求，effort 按 AI 加速版分段估时；日期未知先问用户。
- **修改默认只改本人任务**：`explicit-team` 必须同时满足团队策略授权、用户点名范围、owner 精确匹配和二次确认；否则降级为本人范围。
- **写前 dry-run、写后回读**：任何写操作都必须先输出变更清单，再回读校验结果。  
- **不自动流转状态**：任务创建和估时写回不得自动修改 Story/Task 状态。  
- **不自动提交本地状态**：不得自动 git commit `.tapd/`。  
