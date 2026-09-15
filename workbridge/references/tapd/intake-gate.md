# TAPD 需求 intake（强制阅读）

## 能力前置

- 先执行 `mcp-capability-matrix.md`。
- Story/Task 必须有 `get_stories_or_tasks`，Bug 必须有 `get_bug`。
- `get_image` 是可选能力；缺失时必须列出未读取的原型图片，不能假装已查看。
- 没有运行时可用的 Bug 读取工具时，只保留本地绑定，执行 MCP bootstrap/升级并停止完整 intake。

## 目标输出

- Story 核心约束清单（must/should/out-of-scope）
- 原型信息提取（菜单路径、字段、按钮、状态）
- Story ↔ Tasks 对照（覆盖/遗漏/冲突）
- Bug 复现、影响、关联需求与回归范围
- 代码落点初筛（路由/菜单/页面/API/类型/i18n）
- 若用户要继续实现或要求审核，intake 后进入 `references/tapd/pre-dev-review.md`

## Flow 规格事实源

Story/Task intake 发现 TAPD 受管描述包含 `【FLOW-SPEC-BEGIN:<spec_id>】`，或当前工作区存在与 Story publication 映射匹配的 `.flow/spec.json` 时：

1. 执行 `references/tapd/spec-authority.md` 的完整判定，不在 intake 内另设简化条件。
2. 正式准入后使用精确 Git ref 读取产品文档、原型、scope 和 `AC-*`，不因产品 Repo 当前 checkout 更新而静默切换版本。
3. 未准入时只执行该规则允许的兼容或预研路径，并在输出中明确 gap。
4. 评审后变化进入 `product-review-gate.md` 的增量评审规则。

## 强制步骤

1. 从 context resolve 结果取得 `workspace_id`、`entity_type` 和字符串 ID。
2. 若入口是 Bug：
   - 调用 `get_bug(workspace_id, {id: bug_id, fields: 'id,title,description,status,priority_label,severity,current_owner,reporter,module,feature,iteration_id,created,modified'})`。
   - 提取复现步骤、实际结果、预期结果、环境、影响范围；原描述未提供的字段明确写“未提供”。
   - 有 `get_entity_attachments` 时读取附件列表；图片附件按宿主可用能力查看，无法读取时列出 gap。
   - 有 `get_comments` 时读取该 Bug 评论作为补充时间线，不用评论覆盖 Bug description。
   - 有 `get_entity_relations` 时查询 `relation_type='bug_story'`，列出关联 Story；缺失不阻止 Bug intake。
   - 结合仓库定位疑似代码落点、复现方式和回归测试范围，然后输出 Bug 模板。
   - Bug intake 到此结束，不继续执行下方 Story/Task 专用步骤。
3. 若入口是 Task：
   - 先调用 `get_stories_or_tasks(... entity_type='tasks', id=task_id, fields='id,name,description,status,owner,story_id,parent_id,...')`。
   - 从返回结果取得 `story_id`；不得把 task ID 当成 story ID。
   - 保留该 Task 作为“当前执行焦点”。
   - 若返回缺少 `story_id`，输出 Task-only intake 和缺失项，不猜测父 Story。
4. 若入口是 Story，当前 ID 即 `story_id`。
5. 对 Story/Task 获取父 Story：`get_stories_or_tasks(workspace_id, { entity_type: 'stories', id: story_id, fields: 'id,name,description,...' })`（必须带 `description`）。
6. 先按“Flow 规格事实源”尝试解析产品 Repo；未匹配 Manifest 时再提取 TAPD 原型图。若 `description` 有 `/tfl/captures/...png` 且存在 `get_image`，逐张获取下载地址并读取图片内容；缺少工具时记录 gap。
7. 拉取同 Story tasks：`get_stories_or_tasks(workspace_id, { entity_type: 'tasks', story_id, fields: 'id,name,description,status,owner,created,modified' })`。
8. 用仓库现状做边界：定位相关模块，形成“代码落点初筛”。
9. 输出对应模板；Task 入口额外标明当前焦点 Task。

## 输出模板（必须）

按以下结构输出：

- **Story摘要**：标题、链接、关键背景、规格来源和精确 ref（若缺失写“未提供”）
- **硬约束（must）**：逐条列出（来自 description/原型）  
- **期望（should）**：逐条列出  
- **不在范围（out-of-scope）**：逐条列出（如果无法判断，写“未明确”）  
- **原型提取**：菜单路径 / 页面字段 / 按钮与开关 / 状态与权限可见性  
- **Story ↔ Tasks 对照**：覆盖点 / 漏点 / 冲突点  
- **代码落点初筛**：路由/菜单、页面组件、API、类型、i18n（路径列表即可）  

Bug 使用：

- **Bug 摘要**：标题、链接、状态、严重程度、处理人
- **复现信息**：前置条件 / 操作步骤 / 实际结果 / 预期结果 / 环境
- **影响范围**：用户、模块、版本、数据或权限影响
- **附件与评论**：已读取内容及未读取 gap
- **关联 Story**：关联项或“未提供/能力不可用”
- **修复定位**：疑似根因、代码落点、验证方式
- **回归范围**：主路径、边界、历史行为与自动化测试
