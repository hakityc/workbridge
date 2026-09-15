# TAPD Safety Policy

## 本地 Git 与 context

- 明确的“开始”允许创建业务分支、写 `$GIT_DIR/tapd-context` 本机绑定、写 `~/.tapd-context/cache` 和生成 `.tapd/active-context.md`。
- 明确的“绑定”允许写当前分支本机绑定和 active context。
- 首次 init 的 base 候选必须展示并确认。
- 已有配置、已有绑定或新旧工作项冲突时默认不覆盖。
- 不执行 pull、stash、强制 checkout、自动删分支、自动提交或修改 `.gitignore`。
- dirty 检查仅豁免 `.tapd/config.json`、兼容旧版的 `.tapd/project.json`、`.tapd/context.json`、`.tapd/active-context.md`、`.tapd/logs/**`。
- JSON 使用原子写入；损坏文件停止处理，不用空文件覆盖。
- `.tapd/context.json` 只读兼容旧版本；新版本不默认写入。
- 低置信度分支名恢复可用于本地开发；TAPD 远端写入前必须通过 MCP 重新确认目标对象。

## TAPD 远端写入

所有创建/更新 Requirement、任务、测试用例、评论、工时和排期写入：

1. 按 `team-policy.md` 检查当前 profile 是否允许对应写动作；团队策略只能收紧，不能绕过 token 权限。
2. 先展示 dry-run：对象、关键字段、旧值到新值和预计影响。
3. 用户本轮未明确授权写入：等待确认。
4. 用户已明确说“直接创建/同步/写回”：展示简短 dry-run 后可在本轮执行。
5. 执行后使用可用读取能力回读。
6. 缺少回读能力时必须说明“写入返回成功，但无法列表回读”。
7. 回读与写入结果不一致时标记“写入未确认”。

本地 context 写入不套用 TAPD 远端 dry-run，但仍遵守 base、冲突和覆盖确认。`active-context.md` 是 Agent 阅读产物，不是事实源；分支不匹配时不得使用。

## Owner 精确匹配

owner 字段可能是：

```text
开发者A;
张三;开发者A;
张三，开发者A
```

统一判断：

1. 按 `;`、`；`、`,`、`，` 和任意空白切分。
2. 对每段 trim。
3. 过滤空值。
4. 任一 token 与当前 nick 完全相等才视为本人。

禁止 substring。`开发者A同学`、`小开发者A` 不得匹配 `开发者A`。任务编排和估时排期必须引用本文件，不各自发明规则。

## 团队范围写入

- 默认仍然只允许修改本人任务。
- 只有 `team-policy.md` 解析为 `explicit-team`，且用户本轮明确点名成员、任务 ID 或清晰筛选范围时，才能形成团队范围 dry-run。
- 目标 owner 仍按本文件精确匹配；不得使用 substring，不得把“全部成员”解释为无限范围。
- 团队范围写入必须二次确认，即使用户此前说过“直接处理”。
- 输出必须逐条显示目标成员、任务、旧值、新值与回读结果。

## 凭据与失败

- 不输出 token、Authorization header 或包含 token 的异常。
- MCP/HTTP 失败不得宣称已写入。
- TAPD 远端读写只通过运行时 MCP 工具执行。
- 必需工具缺失时先 bootstrap、升级或 reload；仍缺失则停止远端步骤。
- Skill 不读取 MCP 子进程 token，也不直接调用 TAPD OpenAPI。
- MCP 写入后的回读失败统一标记“写入未确认”。
