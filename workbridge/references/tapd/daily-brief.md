# TAPD 日报/站会简报与今日待办

这是一组只读 TAPD 工作流：不要求 Git 仓库或分支 context，不创建文件，也不写 TAPD。

## 模式选择

先按用户意图路由，不要把两种问题混在一起：

- **日报/站会回顾**：用户说“日报、站会、今天做了什么、明早汇报、明日计划”时使用。它回答今天已经发生了什么，按日期聚合。
- **今日待办规划**：用户说“今天有哪些活、今天做什么、今日 Todo、今天排什么、帮我排一下今天任务”时使用。它回答现在应该推进什么，从**当前迭代内本人未完成的任务**中排出可执行清单。
- **团队迭代盘点**：用户说“团队现在怎么样、迭代风险、团队站会、看下大家负载”时使用。它回答当前迭代的成员 WIP、逾期、阻塞和无人负责事项，不替成员自动改排期。

“今天有哪些活”不是“截止日期等于今天的任务”。`due`、`begin`、`created`、`modified` 都只是排序和风险信号；当前迭代内未完成的本人任务才是候选池。

## 通用输入与边界

优先使用用户本轮给出的 `workspace_id`、用户昵称、日期和迭代；其次读取当前仓库 `.tapd/config.json` 的 `workspace_id/user_nick`；仍缺失时询问一次。

- 日期默认 Asia/Shanghai 的今天，格式 `YYYY-MM-DD`。
- 默认只处理当前用户负责的事项。只有用户明确要求团队盘点时才读取团队范围；团队盘点不把别人的任务排进个人今日待办。
- 不从 Git、聊天记忆或主观猜测补工作内容、依赖、剩余工时或迭代。
- 无论哪种模式都不改状态、排期、owner、工时或 TAPD 评论；用户明确要求写回时，另行进入对应写入工作流。

## 能力前置

先按 `mcp-capability-matrix.md` 检查目标模式所需能力。

日报/站会简报必需 `get_stories_or_tasks`；`get_bug`、`get_comments`、`get_timesheets`、`get_iterations`、`get_workflows_last_steps` 是可选增强。

今日待办规划必需：

- `get_stories_or_tasks`
- `get_iterations`，或用户本轮显式提供的 `iteration_id` / 唯一可解析的 `iteration_name`

`get_bug`、`get_timesheets`、`get_workflows_last_steps` 可选。缺少当前迭代的可靠来源时，说明缺失并询问迭代；不得退化为只查询 `due=今天` 的任务。

团队迭代盘点必需 `get_stories_or_tasks`，并需要 `get_iterations`、用户显式迭代或从任务唯一推断出的迭代。它是只读模式，不要求 lead profile；但必须由用户明确提出团队范围。

## A. 日报/站会回顾

### 采集范围

#### Tasks

调用 `get_stories_or_tasks(workspace_id, options)`：

```json
{
  "entity_type": "tasks",
  "owner": "<nick>",
  "fields": "id,name,status,owner,begin,due,iteration_id,story_id,modified,created",
  "limit": 200,
  "order": "modified desc"
}
```

纳入今日候选：

- `begin <= today <= due`
- `begin == today`
- `due == today`
- `created` 或 `modified` 在 today

#### Bugs、评论和工时

- 有 `get_bug` 时，按 `current_owner=<nick>` 读取并按同样的日期规则纳入。
- 有 `get_comments` 时，仅查询 today 内作者为当前 nick 的评论；评论只用作“今日动作”辅助说明，提炼为 4–18 个字。
- 有 `get_timesheets` 时，查询 `spentdate=today`，只统计总工时和条数。
- 有 `get_iterations` 时，为今日事项与明日计划回填迭代名。

### 分类与输出

完成态包含 task 的 `done`、`closed`、`已完成`、`已关闭`，以及 bug 的 `resolved`、`verified`、`closed`、`已解决`、`已验证`、`已关闭`。状态未知归入进行中并标记“状态待确认”。

- 今日完成：今日候选且处于完成态。
- 进行中：今日候选且未完成。
- 风险：今日计划仍未完成且没有今日评论、工时或状态推进；或 `due < today` 仍未完成；或今日新增且严重程度高的 Bug。
- 明日计划：下一工作日的 `begin` 或 `due` 命中，以及今天未完成且仍需推进的事项；周五时标题写“明日计划（下周一）”。
- 有 `get_workflows_last_steps` 时用其确认完成态；没有时使用上面的通用完成态，不能猜测自定义状态。

严格使用：

```markdown
# YYYY-MM-DD 日报/站会简报

## 今日完成
- 事项名（状态）

## 进行中
- 事项名：下一步

## 风险
- 无

## 明日计划
- 事项名

## 数据
- 任务 X，缺陷 X，评论 X，工时 Xh
- 迭代：迭代名1、迭代名2

## 统计
- 今日事项 X；完成 X；进行中 X；风险 X
```

## B. 今日待办规划（当前迭代）

### 1. 解析当前迭代

按以下顺序定位，不把日期字段当成任务筛选条件：

1. 使用本轮明确给出的 `iteration_id` 或 `iteration_name`。
2. 调用 `get_iterations`，读取 `id,name,status,startdate,enddate`；选择状态未完成且日期窗口覆盖 today 的迭代。
3. 若第 2 步有多个候选，先读取本人 `open` / `progressing` 任务的 `iteration_id`。只有一个迭代与本人未完成任务相交时，选择它；仍有多个时展示名称、日期、本人任务数量并请用户选择。
4. 若没有日期覆盖 today 的迭代，允许使用本人未完成任务唯一归属的未完成迭代；否则明确“未找到可确定的当前迭代”。

`get_iterations` 不可用时，只能使用用户显式迭代，或从本人未完成任务中唯一推断出的 `iteration_id`。不要假定最近创建或最近修改的迭代就是当前迭代。

### 2. 建立候选池

调用 `get_stories_or_tasks` 查询当前用户、当前迭代的任务。服务不支持多状态过滤时，分别查询 `open` 和 `progressing` 后去重。

```json
{
  "entity_type": "tasks",
  "owner": "<nick>",
  "iteration_id": "<current-iteration-id>",
  "status": "open|progressing",
  "fields": "id,name,status,priority_label,owner,iteration_id,begin,due,effort,remaining,story_id,modified,created",
  "limit": 200,
  "order": "due asc"
}
```

排除完成态，但保留 `begin` / `due` 为空、早于今天或晚于今天的未完成任务。时间为空只代表排期信息缺失，不代表任务不能进入候选池。

如有 `get_bug`，只把当前用户负责、当前迭代未解决且严重程度高的 Bug 插入“风险”或“今天先推进”；不要用 Bug 覆盖任务候选池。

### 3. 选择今天可推进的任务

按 `team-policy.md` 合并团队与个人 effort 参数；未配置时沿用 `effort-scheduler.md` 的默认值：每周 30h、5 个工作日、WIP=2，即当天基准容量 6h。用户本轮给出的可用时长、不可做事项或 WIP 优先级更高。

排序规则如下，理由是先收敛已开始和有风险的工作，再避免把整轮迭代同时启动：

1. `progressing` 任务优先继续；逾期未完成任务同时进入风险。
2. `due=today` 或 `begin=today` 的任务优先于一般候选，但不是唯一候选。
3. 再按优先级、最近截止日、已开始日期和修改时间排序；优先级缺失时如实标记，不臆造。
4. 已有进行中任务达到 WIP 上限时，不推荐新的 `open` 任务，只列出继续推进与风险处理项。
5. 使用 `remaining` 优先、`effort` 其次判断是否能放入当天剩余容量。两者都缺失时标为“时长待确认”，至多推荐一条，不能声称它一定能在今天完成。
6. `begin > today` 的任务默认放入“暂不安排：尚未到计划开始日”；只有用户明确要求提前排期、没有其他可做候选，或它已逾期时才可提前推荐，并标注“提前启动”。
7. 任务明确标记依赖未满足、阻塞或需要他人输入时，放入“暂不安排”；没有数据时不得虚构依赖。

输出“今天先推进 + 可排今天”合计最多 3 条。其余当前迭代任务不是被忽略，而是放入“暂不安排”，并说明是 WIP、容量、阻塞、低优先级、状态待确认或信息不足导致。

### 4. 输出模板

```markdown
# YYYY-MM-DD 今日待办建议

## 当前迭代
- 迭代名（开始日～结束日）

## 今天先推进
- 任务名：进行中；建议动作

## 可排今天
- 任务名：优先级 / 截止日 / 预计占用

## 暂不安排
- 任务名：原因

## 风险
- 任务名：已逾期 / 阻塞 / 状态待确认

## 数据
- 当前迭代未完成 X；进行中 X；建议今天推进 X
- 当天容量 Xh；已分配 Xh；时长待确认 X
```

没有可排任务时，写明“当前迭代没有本人未完成任务”或“WIP 已满，今天只建议继续进行中任务”，不要笼统地说“今天没活”。

## C. 团队迭代盘点

1. 按今日待办相同规则解析当前迭代。
2. 查询当前迭代所有 `open` / `progressing` tasks，不传个人 owner；服务不支持多状态时分别查询后去重。
3. 按 `safety-policy.md` 的 owner token 规则拆分成员；owner 为空的任务单列“无人负责”，多人共同 owner 的任务计入每个成员但团队任务总数只计一次。
4. 每位成员输出进行中数量、未开始数量、最近 due 和逾期数量。WIP 阈值按 `team-policy.md` 解析；没有明确阻塞字段或评论证据时不得臆造阻塞。
5. 风险排序：逾期未完成 → 无 owner → 明确阻塞 → WIP 超限 → 临近截止但未开始。不得仅凭长时间未修改就断言阻塞。
6. 团队盘点只给出“需要确认/协调”的建议，不自动调整 owner、effort、begin、due 或状态。

严格使用：

```markdown
# 当前迭代团队盘点

## 迭代概览
- 迭代名：未完成 X；进行中 X；逾期 X

## 成员负载
- 成员：进行中 X / 未开始 X / 逾期 X / 最近截止 YYYY-MM-DD

## 需要协调
- 任务名：无人负责 / 已逾期 / WIP 超限 / 明确阻塞

## 数据缺口
- 缺少依赖/工时/自定义状态等可选数据
```

## 输出纪律

- 每个区块最多 5 条；超过时写“另 X 项”。
- 每行优先“事项名：动作/状态”，尽量不超过 32 个中文字符。
- 不输出原始 JSON、完整 description、评论全文或 token。
- 可选数据源缺失时，在“数据”里用短句说明；不得臆造 Bug、评论、工时、依赖或剩余工时。
