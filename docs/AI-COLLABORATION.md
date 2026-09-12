# ChatGPT 与本地 Codex：local-first 协作流程

本文件只解释 `AGENTS.md` 的协作规则；长期规则以仓库根目录 `AGENTS.md` 为唯一真源。

## 一、核心模型

项目采用 **local-first 开发 + GitHub 正式治理**：

```text
用户提出需求 / 反馈
    ↓
自动判断复用或新建 Issue
    ↓
独立 branch；必要时独立 worktree
    ↓
本地连续开发 + 范围匹配的测试
    ↓
clean fixed candidate
    ↓
push 到 GitHub
    ↓
Draft PR
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

本地优先不等于取消 GitHub。Issue、Draft PR、final Head review 和 main merge 仍是正式治理链路；只是中间小迭代不再频繁 push 和触发 Actions。

## 二、启动检查

每个新的本地开发会话先做：

1. 明确当前 worktree 绝对路径，并设置 `NEWSNOW_EXPECTED_ROOT`；
2. 运行 `AGENTS.md` 中的 Canonical Repository Identity Gate；
3. `git fetch origin`，读取最新 `origin/main:AGENTS.md`、`HANDOFF.md`、`PROGRESS.md`；
4. 核对 branch、HEAD、`git status --short`、实际 `origin/main`；
5. 读取当前 branch 对应的 Issue / PR；
6. 发现未知 dirty 状态、错误 repo、错误 worktree、不唯一 remote 或无法解释的并行变化时停止，不自动 reset/stash/clean。

所有 `gh` 命令显式绑定 `--repo caaaptaintop/newsnow`。

## 三、ChatGPT 与 Codex 分工

### ChatGPT

ChatGPT 仍是技术负责人、主要开发者和独立审查者，负责：

- 需求判断、架构和实现方案；
- 缺陷根因、测试设计和最小修复策略；
- 决定 Issue / branch / worktree / checkpoint / Draft PR / review 路由；
- 源码和 diff 审查；
- CI、Actions、artifact、部署日志审查；
- final Head、merge、部署和云端生产验收；
- 判断哪些事实必须从用户 Mac 获取。

### Codex 本地工具层

在 local-first 工作区中，Codex 负责 ChatGPT 无法直接触达的本地执行：

- 文件读写和精确补丁落地；
- Git branch/worktree/status/commit/push；
- Shell、本地测试、构建；
- Chrome/GUI/macOS；
- launchd、PID、锁、`.data`、本机网络、私钥权限等本机事实。

Codex 按明确方案执行，不独立决定架构，不自行扩大为新功能、重构、生产 D1 操作、调度变更、merge 或部署。发现代码问题时可以复现和保存证据，但修复策略由 ChatGPT 决定。

如果网页端 ChatGPT 没有本地桥接，它不能声称已经读取未 push commit、dirty diff 或本地测试日志。需要网页端正式 review 时，先把成果固定为 clean commit 并同步到 GitHub。

## 四、Issue、branch 与 worktree 自动编排

用户无需判断常规流程：

- 当前反馈属于原 Issue 验收目标、实现直接发现缺陷、必要测试/文档/范围内重构：复用原 Issue；
- 独立新功能、独立业务目标、显著改变验收范围、独立安全/数据/权限问题：新建 Issue；
- 每个独立 Issue 默认独立 branch；
- 需要保留现有现场、并行开发或存在未知 dirty 状态时使用独立 worktree；
- branch 采用 `feat/`、`fix/`、`chore/`、`docs/` 等语义前缀；
- 不自动 force push，不 reset/stash/clean 未知现场。

## 五、fixed candidate 与 Actions

本地修改完成后先运行风险匹配的本地测试和 `git diff` 自审。只有满足以下条件才形成正式同步点：

- worktree clean；
- candidate commit 已固定；
- 本地必要回归通过；
- 已知边界记录清楚；
- 没有未经解释的并行变化。

然后 push 并创建/更新同一 Draft PR。GitHub Actions 用于 fixed candidate 的共享验证，而不是每个微小中间状态的日常前置。

如果真实遇到 Actions 分钟、预算或其他额度错误：停止继续触发 Actions，保存原始错误并报告；不自行充值、提高预算或频繁 rerun。

## 六、独立 review

普通风险候选同步 GitHub 后，默认使用 fresh ChatGPT Web/context 对明确 SHA 做独立 review。review 必须实际查看 changed files、关键实现、测试/CI 和边界，不能只读 PR 描述或绿色状态。

发现问题后继续原 Issue、原 branch、同一 Draft PR 修复；形成新的 fixed Head 后重新 review。

涉及以下高风险时暂停自动 merge并升级审查：生产 D1/迁移/删除、鉴权/Access/密钥、发布协议和事务恢复、来源配置发布门禁、Mac worker/launchd/调度/锁/ledger/outbox、附件/正文持久化边界、不可逆生产写入、CI/部署门槛变更，以及本地与 GitHub 事实不一致。

## 七、缺陷修复标准

优先闭环：

```text
复现
→ 根因
→ 失败回归
→ 最小修复
→ 本地回归
→ fixed candidate
→ independent review
```

禁止通过清缓存、删 ledger/outbox/result/receipt、降低校验、吞错误、扩大重试、绕过验证码/发布门禁等方式制造“恢复”。

## 八、本机任务与 GitHub 回传

确需本机事实时，优先使用直接相关的 Issue/PR。没有对应线程的独立运维/采证任务使用 `HANDOFF.md` 指定的备用 Issue #72。

固定标记：

- `[CHATGPT→CODEX][TASK <id>]`
- `[CODEX→CHATGPT][TASK <id>]`
- `[CHATGPT REVIEW][TASK <id>]`

Codex 回传应包含 Task ID、时间/时区、实际 repo/HEAD、执行对象、关键命令与退出码、before/after、发生的写入、原始证据摘录、路径/大小/mtime/SHA-256、失败和 unknown。

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