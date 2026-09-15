# TAPD 测试用例编排器（Story → 用例）

## 默认团队做法（本 skill 的默认策略）

- **用例挂载层级**：默认把用例统一挂在 **Story**（需求）层，便于产品/测试/研发共同对齐验收；先执行 `references/tapd/spec-authority.md`，正式准入时保留 `AC-*` 验收点 ID。
- **命名规则**：`[模块/功能] <Story标题精简> - <场景>`  
- **用例粒度**：以“可独立验证”的场景为单位，优先覆盖 must 约束与原型核心路径。  

如用户明确要求“按 task 挂载”，先按 `team-policy.md` 解析 profile 前缀，再按对应 tasks 分组创建（仍然从 Story 约束出发）。

## 输入

- Story 一键复制文本 / Story 链接 / Story 长 ID  
- （可选）用户补充：用例目录 `category_id`、优先级策略、是否要覆盖 tasks 粒度  

## 输出

- 创建/更新的用例链接列表（可点击）  
- 覆盖的验收点清单（must/should）  
- 未覆盖点与原因（如缺后端接口/缺原型信息）  

## 强制步骤

1. **确保 MCP 可用**  
   - 若不可用，先执行 `references/tapd/mcp-bootstrap.md`  
   - 按 `references/tapd/mcp-capability-matrix.md` 检查用例创建工具；`get_tcases` 和 `entity_relations` 均为可选能力  
2. **完成需求 intake（强制）**  
   - 执行 `references/tapd/intake-gate.md`，拿到：Story 约束、原型交互、tasks 对照  
3. **生成测试点 → 用例草稿**  
   - 从 Story 条款与原型提取：  
     - 正向主链路  
     - 关键边界/禁止项（例如“不允许 X”，“仅 Y 时触发”）  
     - 权限/状态相关的可见性与操作限制（若原型/需求提到）  
   - 每条用例必须包含：`precondition / steps / expectation`  
4. **避免重复（可选但推荐）**  
   - 存在 `get_tcases` 时通过 name 模糊匹配检查同名用例；缺失时在 dry-run 中提示无法预查重复  
5. **写入 TAPD**  
   - 按 `team-policy.md` 解析 profile；团队策略明确禁止 `create-tcase` 时只输出用例草案。缺少团队策略时沿用安全默认和 MCP 能力门禁。
   - 先按 `safety-policy.md` 展示 dry-run；未明确授权写入时等待确认  
   - 数量 ≤ 5：用 `create_or_update_tcases` 逐条创建（便于定位失败）  
   - 数量 > 5：用 `create_tcases_batch` 批量创建  
   - 关键字段建议：  
     - `status`: `normal`  
     - `priority`: 默认 `P2`（或按风险把 must 设 `P1`）  
     - `type`: `功能测试`  
   - `category_id` 若用户未提供：先不填（使用 TAPD 默认目录）  
6. **关联 Story（独立步骤）**
   - 只有运行时存在 `entity_relations` 时才关联
   - 缺少关联能力不回滚已创建用例，明确输出“用例已创建，但未关联 Story”  
7. **回显结果**  
   - 返回每条用例的链接（`{tapd_base_url}/{workspace_id}/sparrow/tcase/view/{id}`）  
   - 同时输出“覆盖清单/遗漏清单”  

## 用例内容模板（必须遵守）

对每条用例，生成字段：  
- **name**：一句话描述场景  
- **precondition**：前置条件（环境/账号/数据准备）  
- **steps**：步骤（编号 1..n）  
- **expectation**：预期结果（与步骤对应）  

严禁：只写一句“验证XX功能正常”这种不可执行用例。  

## 失败处理

- MCP 接口失败：停止写入，先完成 bootstrap + Reload，再重试；不绕过 MCP 直接调用 OpenAPI。
- intake 信息不全（无原型/无描述）：先输出“缺失信息清单”，并只生成最小可用用例集合。  
- 关联 Story 返回 403：说明当前 token/用户缺少返回中指明的权限（常见为 `stories::add_story_tcase`），保留已创建用例并将关联标记为失败。  

## 输出模板（必须）

按以下结构输出：

- **Summary**：创建/更新了多少条；是否完成关联；是否发生权限不足
- **Links**：用例链接列表  
- **Coverage**：must/should 覆盖清单  
- **Gaps**：未覆盖点与原因  
- **Next actions**：若需要更高权限/补原型/补后端接口，列 1-3 条最小行动项  
