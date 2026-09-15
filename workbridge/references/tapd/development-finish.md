# TAPD 开发收尾

用户说“做完了、收尾、准备提交、登记工时、生成提交信息”时使用。默认完成本地验证和摘要，不自动流转 TAPD 状态。

## 必做检查

1. 用当前分支 context 确认工作项。
2. 查看 `git status` 和 `git diff`，确保没有误改用户文件或把 `.tapd` 本地生成物纳入提交。
3. 运行与改动相关的测试、lint、类型检查或构建。
4. 对照 Story must、焦点 Task、原型和计划给出通过/未通过/未验证清单。
5. 输出完成摘要、风险和待联调项。

## 提交关键字

- 运行时存在 `get_commit_msg` 时，可读取 TAPD 源码提交关键字。
- 默认只生成建议提交信息，不自动 commit。
- 用户明确要求提交时，遵循仓库提交规范，并确保不提交 `.tapd/config.json`、`.tapd/context.json`、`.tapd/active-context.md` 或 logs。

## 工时登记

- 按 `team-policy.md` 检查当前 profile 是否允许 `write-timesheet`；明确禁止时只生成登记草案。
- `get_timesheets`、`add_timesheets`、`update_timesheets` 都按运行时能力探测。
- 登记前展示日期、对象、owner、已登记工时、增量/覆盖值、剩余工时和 memo。
- 同日已有记录时优先更新，不重复新增。
- 缺少读取能力时默认只生成登记草案；用户明确授权直接登记后仍需标记无法查重的风险。

## TAPD 结果同步

- 评论同步使用 `create_comments`，遵守 dry-run 和回读语义。
- 不自动把 Story/Task 改为完成，不自动发起 MR 或提测。
- context 默认保留，便于返工或继续；第一版不自动清理绑定。
