# 将代码内任务注释同步到 TAPD 评论

与 `SKILL.md`「代码内任务注释」配套：**在仓库里新增或实质性修改**了绑定 TAPD 的 TODO/联调注释后，应在 TAPD **对应 Story 或 Task** 下追加一条评论，便于评审、测试与后端在 TAPD 内看到上下文。`references/tapd/pre-dev-review.md` 中经用户确认的编码前审核问题，也复用本文件的 `create_comments`、dry-run 和回读规则。

## 何时触发

- 新增 `TODO(...): [TAPD] …` 或等价绑定注释时。  
- 该 TODO 的**含义或阻塞原因**发生实质变化时（可再发一条评论摘要变更；不必为改错别字重复发）。
- 编码前审核发现产品文档/原型/Tasks 的高影响问题，且用户明确确认需要同步到 TAPD 时。

## 使用 tapd-mcp：`create_comments`

调用前阅读 MCP 工具 schema（`create_comments`）。必填语义如下：

| 参数路径 | 说明 |
|----------|------|
| `workspace_id` | TAPD 项目 ID（整数，与链接或 `get_stories_or_tasks` 所用 workspace 一致）。 |
| `options.entry_id` | 被评论对象的实体 ID：需求/Story 或 任务/Task 的 **id**（与 TAPD 链接或接口返回一致）。 |
| `options.entry_type` | `stories`（需求/Story）或 `tasks`（任务/Task），**必须与 entry_id 类型一致**。 |
| `options.author` | 评论人：使用当前用户在 TAPD 中的 **昵称**（与 OpenAPI `users/info` 返回的 `nick` 一致）。使用已确认的当前身份；缺少时询问用户，不直接读取 token 或调用 OpenAPI。 |
| `options.description` | 评论正文（**推荐 HTML 分段**，便于 TAPD 内换行与列表渲染；纯文本亦可）。 |

`create_comments` 是评论写入的必需能力，`get_comments` 只是可选回读能力。写入前按 `safety-policy.md` 展示 dry-run：

- 用户未明确授权同步时，等待确认。
- 已明确要求“直接同步”时，展示简短摘要后执行。
- `create_comments` 返回明确成功但没有 `get_comments` 时，输出“写入成功，但无法评论列表回读”。
- 返回结果不明确或可用回读失败时，标记“写入未确认”。

---

## 评论正文格式规范（推荐：分点、可扫描）

目标：**一眼能看懂「在等什么、和谁有关、去哪改代码、怎么验收」**，风格对齐常见研发协作文档（标题 + 分点 + 锚点 + 下一步）。

### 必选块（按顺序）

1. **标题行（单行）**  
   - 固定前缀：`【前端代码备注同步】` 或 `【后端代码备注同步】` / `【联调阻塞说明】`（按实际角色选）。  
   - 后接 **不超过 40 字的结论**，必要时用括号注明与仓库 TODO 标签一致，例如：`（与 TODO(backend-xxx) 一致）`。

2. **阻塞 / 背景（1～2 句）**  
   - 用完整句写清：**当前卡点是什么**、**不解决的影响**（例如：参会人无法同步、配置页仅为 mock 等）。  
   - 避免与下文「要点」重复堆长句。

3. **要点（分点列表，3～7 条为宜）**  
   - 使用 **有序列表 `1.` `2.` `3.`** 或 **无序 `-` 列表**，每条只表达一个可验证事实或待确认项。  
   - 每条尽量包含：**对象**（接口/字段/事件）+ **动作**（需确认/待实现/待对齐）+ **可选：负责人或系统边界**（前端/后端/网关）。  
   - 需要联调确认时，用「需确认：」「待对齐：」等可扫读前缀。

4. **代码锚点（独立小节，必选）**  
   - 小节标题固定为：`代码锚点：`  
   - 每条一行：`路径` + 可选 `（#函数名 / 区域说明）`；多文件时 **按依赖顺序自上而下** 排列。  
   - 优先写 **仓库相对路径**；行号可选（易变），有则写 `path:行号` 无则省略。

5. **关联与追溯（必选其一）**  
   - **Story/Task 链接**（完整 URL），或  
   - **仓库**分支名 / PR 链接（若有），或  
   - **规范文档**：`.cursor/rules/xxx.mdc`、Confluence、接口文档路径（一句话说明「详见 xxx」）。

6. **收尾一句（推荐）**  
   - 说明 **联调通过后的动作**（例如：删除对应 TODO、在此单勾选验收、关闭子任务等）。

### 可选块

- **状态标签**：若 TAPD 工作流支持在标题或首段标注 `[待联调]` `[进行中]` 等，与看板一致即可（勿与需求状态字段冲突时以字段为准）。  
- **@ 相关人**：仅在明确知晓 TAPD @ 语法且对方账号时使用。  
- **风险 / 回滚**：影响面较大时加 1～2 条。

### 反模式（避免）

- 一大段无标题、无列表的散文。  
- 只有情绪或结论，**没有代码路径**、没有可执行要点。  
- 与仓库 TODO 语义**不一致**（评论与代码各说各话）。  
- 为同一次微小措辞修改重复刷屏评论。

---

## MCP `description` 推荐写法（HTML 示例）

TAPD 接口常将 `description` 存为 HTML，使用 `<p>` / `<ul><li>` 可读性更好：

```html
<p><b>【前端代码备注同步】</b>翻译 WS 源语言与后端对齐（与仓库 TODO(backend-translations-ws) 一致）</p>
<p><b>阻塞说明：</b>主持端与参会端对 source_language 来源不一致，需与下行 WS 及 REST 对齐后再删 TODO。</p>
<p><b>要点：</b></p>
<ul>
<li>需确认：<code>getTranslationRooms</code> 返回的 <code>source_language</code> 与主持端、<code>normalizeTranslationServiceLangCode</code> 是否一致。</li>
<li>需确认：下行 <code>subscribed</code> 是否携带 <code>source_language</code>。</li>
<li>待对齐：主持 <code>update_source_language</code> 后是否广播 <code>room_config_updated</code>（同 <code>room_id</code>），否则参会人无轮询无法同步源语。</li>
</ul>
<p><b>代码锚点：</b></p>
<ul>
<li><code>src/views/meeting/online-room/composables/useOnlineAttendeeTranslation.ts</code>（subscribed / room_config_updated）</li>
<li><code>src/shared/types/translation.ts</code>（<code>WsSubscribedMsg</code> / <code>WsRoomConfigUpdatedMsg</code>）</li>
</ul>
<p><b>关联：</b>详见 <code>.cursor/rules/todo-tree-translation-backend.mdc</code>；联调通过后前端将删除对应 TODO，并在此 Story 跟进验收。</p>
```

纯文本降级（无 HTML 时）仍须保留：**标题行 + 阻塞 + 要点（多行 `-`）+ 代码锚点 + 关联 + 收尾**。

---

## 纯文本模板（复制即用）

```text
【前端代码备注同步】<一句话结论>（与 TODO(<标签>) 一致）

阻塞说明：
<1～2 句说明在等什么、影响面>

要点：
1. <可验证项 / 待确认项>
2. <可验证项 / 待确认项>
3. <可验证项 / 待确认项>

代码锚点：
- src/.../foo.ts（#函数或区域说明）
- src/.../bar.ts（#函数或区域说明）

关联：
- Story：<完整 TAPD URL>
- （可选）分支：xxx / PR：xxx / 文档：路径或链接

收尾：
联调通过后 <删 TODO / 更新验收 / 关闭子任务>。
```

---

## 失败与降级

- MCP 不可用：按 `references/tapd/mcp-bootstrap.md` 处理；**不得静默跳过**——在对话中说明「未写入 TAPD 评论」及原因，并提示用户可手动粘贴到 TAPD（并建议按上文**纯文本模板**排版）。  
- `create_comments` 返回权限错误：在输出中写明所需 TAPD 权限，并建议用户手动补评论。
- 缺少 `create_comments` 时不得以 `get_comments` 或其他读取工具替代写入。
- 缺少 `create_comments` 时先 bootstrap/升级 MCP；仍缺失则停止，不直接调用 OpenAPI。
