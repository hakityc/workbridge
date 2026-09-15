# Flow 产品评审 Gate

产品经理说“发起评审、准备产品评审、记录评审结论、评审通过、评审后改需求”时使用。目标是冻结一个可供前端、后端和测试共同执行的规格版本，而不是只生成一份会议摘要。

## 前置

- 必须先执行 `references/tapd/spec-publisher.md` 的 Manifest Gate 和规格审核。
- 开发准入统一遵守 `references/tapd/spec-authority.md`。
- Requirement 必须存在远端映射；尚未发布时先输出发布 dry-run。
- 使用 `source.ref` 的精确 commit，不读取工作区里不同版本的文档冒充评审内容。
- TAPD 当前作为 Provider 时，评论写入使用 `create_comments`，所有写入遵守 `team-policy.md` 和 `safety-policy.md`。

## 评审输入包

评审前生成一份可直接用于会议的输入包：

1. 产品目标、用户价值和明确非目标。
2. 产品文档与原型版本。
3. must / should 与 `AC-*` 验收点。
4. 文档 ↔ 原型高影响差异。
5. 权限、状态、异常和历史兼容矩阵。
6. 前端、后端、质量任务草案。
7. 接口、数据、环境和发布依赖。
8. 需要产品 / 前端 / 后端共同决定的问题，最多 8 条。

没有专职测试时，必须为当前 Requirement 指定“质量负责人”候选，避免“大家自己测”导致无人对验收覆盖负责。

## Gate 结果

评审结果只能是：

- `approved`：高影响问题已关闭或有明确 owner、截止时间和不阻塞理由；验收点可执行。
- `changes-required`：仍有会改变实现、阻塞接口、影响验收或发布安全的问题。
- `reviewing`：评审进行中或结论未完成。

不得由 AI 根据会议文本自动判定 `approved`。只有用户明确确认评审结论后才能更新 Manifest。

## 结论记录

确认后执行：

1. 将评审决定追加到 `source.decisions` 指向的文件；文件未配置时输出建议路径，不擅自创建到未知位置。
2. 更新 `.flow/spec.json`：
   - `review.status`
   - `review.reviewed_ref`（必须是 source.ref 的精确 commit）
   - `review.decided_at`
   更新后再次调用 `tapd-context spec validate`；校验未通过不得同步 approved 状态。
3. 将评审结论、未决项、owner 和 `reviewed_ref` 作为 TAPD 评论 dry-run；授权后写入并回读。
4. 重新生成 Requirement 受管区块；即使产品内容 commit 未变化，只要 review 元数据变化，也要展示更新 dry-run，授权后写入并回读，避免 Story 仍显示旧评审状态。
5. 不自动流转 TAPD Story 状态，不自动创建任务；任务创建仍走 `task-orchestrator.md`。
6. 输出可复制的评审通知，当前没有可靠通知能力时不得声称已通知成员。

## 评审后变更

当 `source.ref != review.reviewed_ref`：

1. 将需求视为“评审后发生变化”，不得继续声称当前开发基于已通过版本。
2. 对比 reviewed_ref 与 source.ref，生成只包含影响范围的变更摘要。
3. 分类：文案无行为变化 / 验收变化 / 接口或数据变化 / 范围变化 / 发布风险变化。
4. 后四类必须进入增量评审；用户确认后更新评论和 reviewed_ref。
5. 已创建任务受影响时列出待更新项，不直接批量覆盖 owner、effort 或 due。

## 开发准入

开发工作流读取 `.flow/spec.json` 时执行 `references/tapd/spec-authority.md`，不得在各工作流内重新定义或放宽准入条件。

## 输出模板

```text
产品评审 Gate

规格：<spec_id> @ <commit>
远端需求：<provider + link>
结论：approved / changes-required / reviewing

已确认：
- ...

待处理：
- 问题 / owner / 截止时间 / 是否阻塞

任务草案：
- 前端 ...
- 后端 ...
- 质量 ...

下一步：发布修订 / 创建任务 / 开始开发
```
