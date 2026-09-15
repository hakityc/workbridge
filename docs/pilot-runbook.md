# Flow 内部试用手册

## 试用定位

本轮是团队内部 Beta：核心链路必须能跑通，产品和研发在真实使用中反馈交互、文案和流程优化点。它不是一次性替换所有研发流程，也不承诺当前已经包含后端、AI E2E、发布 Gate 或飞书 Adapter。

## 明天演示前准备

- 使用一个真实但风险可控的产品需求。
- 产品文档和原型已经提交到产品 Git Repo，仓库存在 `origin` remote。
- 确认演示用 TAPD workspace；演示者有创建和更新 Story、写评论权限。
- 更新到最新 TAPD Skill。
- TAPD MCP 已启动，并能只读获取参与项目。
- 演示前保留一份 TAPD 手工创建需求的备选方案；远端异常时展示 dry-run，不重复点击创建。

## 推荐演示脚本

### 1. 初始化产品流程

在产品仓库中说：

```text
/workbridge 初始化当前产品仓库的 Flow 需求。
产品文档是 <path>，原型在 <path>，TAPD workspace_id=<id>。
先给我看范围和验收点，确认后再写文件。
```

预期结果：

- AI 读取已提交的产品文档和原型。
- 输出标题、in-scope、out-of-scope 和 `AC-*` 草案。
- 确认后调用 `tapd-context spec init`。
- `tapd-context spec validate` 返回 `manifest_valid=true` 和 `provider_supported=true`。
- AI 继续完成 MCP 必需工具、profile 写权限、workspace 只读可达性检查；本地校验不能代替 Provider 门禁。
- `.flow/spec.json` 引用精确的 40 位 Git commit。

### 2. 发布 TAPD Requirement

```text
/workbridge 从当前产品仓库发布需求。先给我看 dry-run，确认后创建。
```

预期结果：

- 展示稳定标题、规格版本、范围和验收点。
- 先查询是否已有同 `spec_id` 的受管 Story。
- 创建后回读 ID/URL，并回填 `.flow/spec.json`。
- 明确提示提交 Manifest 映射变更，不自动 git commit。

### 3. 证明幂等

再次执行：

```text
/workbridge 再发布一次当前需求。
```

预期结果：内容和评审状态未变化时显示幂等跳过，不创建第二条 Story。

### 4. 准备产品评审

```text
/workbridge 准备产品评审，列出高影响差异、依赖、待决问题和前端/后端/质量任务草案。
```

预期结果：输出可直接用于会议的评审包；AI 不自动判定通过。

### 5. 记录人工结论

```text
/workbridge 记录评审结论：approved。先展示将修改的 Manifest 和 TAPD 内容，确认后写入。
```

预期结果：

- 写入 `review.status/reviewed_ref/decided_at`。
- 再次通过 `tapd-context spec validate`。
- 更新 TAPD 受管区块；有评论能力时同步评审摘要。
- 不自动流转 TAPD Story 状态，不声称已通知成员。

## 失败时怎么处理

| 现象 | 处理 |
|---|---|
| `SPEC_NOT_INITIALIZED` | 先执行“初始化产品流程” |
| `INVALID_SPEC_MANIFEST` | 按 issues 修复路径、ref、scope 或 AC，不绕过校验 |
| `GIT_REMOTE_NOT_FOUND` | 为产品仓库配置正确 origin 后重试 |
| MCP 工具缺失 | 更新到兼容版本并 reload；仍缺失则只展示草案 |
| TAPD 权限不足 | 停止远端写入，请 workspace 管理员补权限 |
| 创建返回不明确 | 先按稳定标题和受管标记查询，不直接再次创建 |
| TAPD 写入成功但本地回填失败 | 记录返回 ID，恢复 Manifest 映射，不创建第二条 |

任何失败都不允许直接改调 OpenAPI、不允许跳过 dry-run，也不能把未确认的写入说成成功。

## 试用成员只需知道三件事

1. 产品文档和原型先提交 Git。
2. 直接说业务目标即可，例如“根据当前文档创建需求”；AI 会自动检查环境。首次连接 TAPD 账号时按引导完成一次授权，不要把 Token 发到聊天或仓库。
3. 关键写入先看 dry-run，再确认；遇到不顺手或判断错误，保留输入和结果，作为下一轮迭代反馈。

## 收集什么反馈

- 哪一步还需要填写过多信息？
- AI 生成的 scope 和验收点是否符合产品表达习惯？
- 产品评审包哪些部分有用，哪些过重？
- 失败提示能否让非开发成员独立恢复？
- TAPD 摘要是否够用，是否仍需要手工复制内容？
- 哪些工作应该自动做，哪些必须继续人工确认？

## 试用成功标准

一次真实需求满足以下条件即视为链路跑通：

- 产品 Repo 生成并提交有效 Manifest。
- TAPD 只产生一条对应 Requirement。
- Requirement 能追溯到精确产品 commit。
- 产品评审结论由人确认并绑定 reviewed_ref。
- 开发能够从同一 Requirement 读取已评审规格。
- 失败或缺权限时没有重复写入、越权写入或假成功。
