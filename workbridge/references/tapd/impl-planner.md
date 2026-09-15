# TAPD 实现计划编排（Story + Tasks → Plan）

## 前置

- 必须先完成 intake：`references/tapd/intake-gate.md`
- 进入实现计划或编码前，必须先执行 `references/tapd/pre-dev-review.md`。若用户已在本轮确认“跳过编码前审核”，在输出中记录该决定后继续。
- 按 `references/tapd/mcp-capability-matrix.md` 检查能力；评论同步是可选附加步骤，不阻止生成计划。
- 所有本地与远端修改遵守 `references/tapd/safety-policy.md`。

## Plan 输出要求

Plan 必须包含：

- 需求硬约束（Story 条款 + 原型交互）  
- 任务拆解顺序与依赖（以 tasks 作为执行顺序参考）  
- 关键文件路径（路由/菜单/页面/API/类型/i18n）  
- 联调占位策略（无接口只能 UI+参数骨架+disabled）  
- 验收口径（与 Story/原型对齐）  

## 执行纪律

- 先执行 `references/tapd/spec-authority.md`；正式准入时使用 reviewed_ref 产品规格，否则只走该规则允许的兼容或预研路径。tasks 用于组织执行顺序与验收颗粒度。
- 编码前审核只保留高影响问题；用户确认的问题先走 TAPD 评论 dry-run，再进入计划或编码。  
- 发现 tasks 漏拆：补计划步骤，但不擅自扩需求。  
- 缺后端信息：明确“待联调”项与后续补齐点。  
- 用户要求“实现、写代码、按任务做、继续开发”时，计划完成后继续执行 `references/tapd/development-executor.md`，不得停在方案文本。
- 若在代码中留下绑定 TAPD 的 TODO/联调注释且含义有实质变化：按 **`references/tapd/sync-code-comment-to-tapd.md`** 用 `create_comments` 同步到 Story/Task；评论正文须为 **分点式**（标题行 + 阻塞 + 要点 + 代码锚点 + 关联 + 收尾），推荐 HTML 列表便于 TAPD 渲染。  

## 输出模板（必须）

按以下结构输出：

- **Summary**：1-3 条结论（面向评审）  
- **Scope**：in-scope / out-of-scope  
- **Tasks mapping**：task_id → 计划步骤/文件落点/验收点  
- **Implementation steps**：按依赖顺序列步骤（每步标注文件路径）  
- **Risk & rollback**：高风险点、降级/回滚策略  
- **Test plan**：手工验证要点（不写测试代码，除非用户明确要求）  
