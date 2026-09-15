# Flow 规格准入规则

这是产品规格能否作为正式开发事实源的唯一判定规则，intake、计划、测试和评审流程都引用本规则，不各自缩写或改写。

## 正式准入

同时满足以下条件时，`review.reviewed_ref` 是完整规格事实源：

1. `.flow/spec.json` 已通过 Manifest Gate。
2. `publication.external_id` 能回读到当前 Provider Requirement。
3. `review.status` 严格等于 `approved`。
4. `source.ref` 和 `review.reviewed_ref` 都解析为精确 commit，且两者相等。
5. 产品文档、原型和 decisions 路径没有越出产品 Repo。

Provider Requirement、评论和任务是执行上下文，不能覆盖该精确版本的产品规格。

## 未准入

- Manifest 不存在：兼容使用 TAPD Story description 与原型，但明确标注“未绑定 Flow 规格”。
- 未发布或映射损坏：停止正式准入，先完成发布或修复映射。
- `draft`、`reviewing`、`changes-required`：只允许澄清、技术预研和只读计划。
- `source.ref != review.reviewed_ref`：视为评审后变更，对受影响范围做增量复审。
- 精确 ref 无法读取：停止，不用当前工作区内容冒充已评审版本。
