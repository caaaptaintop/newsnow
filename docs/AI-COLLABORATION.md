# ChatGPT 与本地 Codex：local-first 协作流程

本文件只解释 `AGENTS.md` 的协作规则；长期规则以仓库根目录 `AGENTS.md` 为唯一真源。

## 一、核心模型

项目采用 **本地优先执行 + GitHub 正式治理**。默认开发现场是明确的本地 Codex 工作区；`codex-chatgpt-web` / MCP 把 ChatGPT Web 模型接入同一 worktree，由 Web 模型负责开发判断与修改决策，由 Codex 工具层执行本地文件、Git、Shell、测试、构建、GUI/macOS 和事实采集。GitHub 用于正式同步、PR、独立审查和 main 治理，不承担每个本地小迭代的中间交接。

```text
用户提出需求 / 反馈
    ↓
自动判断复用或新建 Issue
    ↓
独立 branch；按并行、保留现场或 dirty 隔离需要使用独立 worktree
    ↓
codex-chatgpt-web/MCP 进入同一 worktree
    ↓
ChatGPT Web 主导开发判断/修改 + Codex 工具层执行适用验证
    ↓
clean fixed candidate
    ↓
push 到 GitHub / 更新 Draft PR
    ↓
fresh independent review（绑定明确 SHA）
    ↓
发现问题 → 原 Issue / branch / PR 继续修
    ↓
final Head
    ↓
merge main
    ↓
部署与生产验收
```

桥接不可用、不能证明 Web 模型进入同一明确 worktree，或 Web 返回的本地事实与工具层独立核对不一致时，本地开发链路明确阻断并记录原因。普通开发不把“网页端直接修改 GitHub”作为默认降级路径。

本地优先不等于取消 GitHub。Issue、Draft PR、final Head review 和 main merge 仍是正式治理链路；只是中间小迭代不再以频繁 push 和 Actions 作为默认开发方法。

## 二、启动检查

使用本地 worktree 的会话先做：

1. 明确当前 worktree 绝对路径，并设置 `NEWSNOW_EXPECTED_ROOT`；
2. 运行 `AGENTS.md` 中的 Canonical Repository Identity Gate；
3. `git fetch origin`，读取最新 `origin/main:AGENTS.md`、`HANDOFF.md`、`PROGRESS.md`；
4. 核对 branch、HEAD、`git status --short`、实际 `origin/main`；
5. 读取当前 branch 对应的 Issue / PR；
6. 发现未知 dirty 状态、错误 repo、错误 worktree、不唯一 remote、桥接不能进入同一 worktree 或无法解释的并行变化时停止，不自动 reset/stash/clean。

所有 `gh` 命令显式绑定 `--repo caaaptaintop/newsnow`。

ChatGPT Web 只有通过桥接实际进入当前 worktree 后，才可把未 push commit、dirty diff、本地测试和本机文件状态作为开发事实。无法进入时记录阻断；远端 GitHub 只读核对可以继续，但不能替代本地开发现场。

## 三、ChatGPT Web 与 Codex 本地工具分工

### ChatGPT Web 模型

通过 `codex-chatgpt-web` / MCP 进入同一明确 worktree 后，Web 模型负责：

- 需求判断、架构和实现方案；
- 源码/文档修改决策与缺陷修复判断；
- 测试设计与验证范围；
- Issue / branch / checkpoint / Draft PR / review 路由；
- 本地源码和完整 diff 审查；
- CI、Actions、artifact、部署日志审查；
- final Head、merge、部署和云端生产验收的阶段判断。

### Codex 本地工具层

Codex 工具层在同一 worktree 执行 Web 模型的开发决策，包括文件读写、Git、Shell、测试、构建、GUI/macOS 和本机事实采集。普通源码修改、测试和 Git 操作属于正常工具执行范围，不再要求先证明“ChatGPT/GitHub/CI 都无法完成”。执行范围仍受当前 Issue、用户授权、允许写入文件和生产保护约束。

### 原生 Codex 模型专项

原生 Codex 模型只按需承担边界清晰的本机专项，例如生产副本、`.data`、日志和状态文件、launchd/plist、PID/PPID、锁、900 秒自然周期、本机 CLI 登录态/私钥权限、必须依赖本机桌面的真实交互或本机网络采证。专项不为形式上的“独立”重复整套需求、架构、实现和审查推理，也不能自行扩大为未授权重构、生产写入、合并或部署。

桥接不可用或不能证明同一 worktree 时，本地开发 fail-closed；需要脱离本地桥接进行正式 Web review 时，先固定 clean commit 并同步到 GitHub，再对明确 GitHub SHA 独立审查。Codex 工具结果或原生 Codex 自报“通过”都不替代独立 review。

## 四、Issue、branch 与 worktree 自动编排

用户无需判断常规流程：

- 当前反馈属于原 Issue 验收目标、实现直接发现缺陷、必要测试/文档/范围内重构：复用原 Issue；
- 独立新功能、独立业务目标、显著改变验收范围、独立安全/数据/权限问题：新建 Issue；
- 每个独立 Issue 默认独立 branch；
- 默认从明确的本地 Codex 工作区推进；需要保留现场、并行开发或隔离未知 dirty 状态时编排独立 worktree；
- branch 采用 `feat/`、`fix/`、`chore/`、`docs/` 等语义前缀；
- 不自动 force push，不 reset/stash/clean 未知现场。

## 五、fixed candidate、最低测试矩阵与 Actions

local-first 只改变验证执行位置和同步频率，不降低测试门槛。代码变更至少执行 `AGENTS.md` 中与改动范围相匹配的最低矩阵：

- 单元/回归测试；
- 改动文件 lint/类型检查门禁；
- 必要构建；
- 涉及发布时的发布安全回归；
- 涉及页面/交互时的浏览器交互检查；
- 涉及恢复/幂等/事务/故障处理时的重复执行和失败路径测试。

纯文档/治理变更至少核对内容一致性、最终 diff 和相关引用；Identity Gate 变更还应做隔离的允许/拒绝路径验证；workflow 变更需要验证语法与触发条件。

已有全库范围外诊断可以单列；“改动文件 0 新错误”不能写成“全库无错误”。历史 CI 只对其固定 SHA 有效。

在同一 worktree 中由 ChatGPT Web 设计验证、Codex 工具层执行适用测试，并完成最终 diff 自审。只有满足以下条件才形成正式同步点：

- candidate 已固定；
- 若存在本地 worktree则必须 clean；
- 最低测试矩阵中的适用项已完成；
- 已知边界记录清楚；
- 没有未经解释的并行变化。

随后 push 并创建/更新同一 Draft PR。GitHub Actions 用于 fixed candidate 的共享验证，而不是每个微小中间状态的日常前置。桥接或本地执行能力缺失时记录阻断/未验证项，不把 GitHub/CI 变成普通开发的默认替代现场。

如果真实遇到 Actions 分钟、预算或其他额度错误：停止继续触发 Actions，保存原始错误并报告；不自行充值、提高预算或频繁 rerun。

## 六、独立 review

普通风险候选同步 GitHub 后，默认通过已连接桥接自动创建新的 fresh ChatGPT Web task/context，对明确 SHA 做独立 review，并由本地编排回收结果；用户无需手工搬运上下文或频繁切换网页端。review 必须实际查看 changed files、关键实现、最低测试矩阵的适用项、CI 和边界，不能只读 PR 描述或绿色状态。若桥接不能保证真正 fresh context，则 review 明确阻断并记录原因。

发现问题后继续原 Issue、原 branch、同一 Draft PR 修复；形成新的 fixed Head 后重新 review。

涉及以下高风险时暂停自动 merge、固定待审 Head 并升级更高等级独立 Web 审查：生产 D1/迁移/删除、鉴权/Access/密钥、发布协议和事务恢复、来源配置发布门禁、Mac worker/launchd/调度/锁/ledger/outbox、附件/正文持久化边界、不可逆生产写入、CI/部署门槛变更、治理/review 路由变化，以及本地与 GitHub 事实不一致。高风险审查通过前不得合并。

## 七、缺陷修复标准

优先闭环：

```text
复现
→ 根因
→ 失败回归
→ 最小修复
→ 适用回归
→ fixed candidate
→ independent review
```

禁止通过清缓存、删 ledger/outbox/result/receipt、降低校验、吞错误、扩大重试、绕过验证码/发布门禁等方式制造“恢复”。

## 八、本机任务与 GitHub 回传

普通文件/Git/Shell/测试由同一 worktree 的 Codex 工具层直接执行。需要另起原生 Codex 本机专项或回传独立运维/采证证据时，优先使用直接相关的 Issue/PR；没有对应线程时使用 Issue #72 `ChatGPT ↔ Codex 本机任务交接总线`。

固定标记：

- `[CHATGPT→CODEX][TASK <id>]`
- `[CODEX→CHATGPT][TASK <id>]`
- `[CHATGPT REVIEW][TASK <id>]`

原生 Codex 专项回传应包含 Task ID、时间/时区、实际 repo/HEAD、执行对象、关键命令与退出码、before/after、发生的写入、原始证据摘录、路径/大小/mtime/SHA-256、失败和 unknown。

证据默认路由：少量文本到 Issue/PR；源码/测试/fixture/文档到 branch + PR；CI 到 Actions；敏感本机原件留 Mac，只回传必要脱敏摘录和哈希。

禁止上传真实密钥、Token、Cookie、密码、私钥内容、原始生产数据库、完整正文/HTML、附件字节。

## 九、生产边界不因流程迁移改变

local-first 只改变开发治理，不扩大任何生产权限：

- 公开仍只启用 `building`；
- 内部来源管理中心仍由 Cloudflare Access 和应用层校验保护；
- D1 不为测试重建/清空/重复迁移；
- Mac worker 继续现有 launchd 和 900 秒自然周期；
- 不新增第二调度器，不为测试 kickstart；
- 正文/完整 HTML/附件字节仍不得长期持久化；
- 来源仍低并发、有限请求、禁止 TLS 降级/验证码绕过/高频重试；
- 未经用户同意不新增收费 API、代理或模型费用。

这些稳定保护以 `AGENTS.md` 为准。
