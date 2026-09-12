# ChatGPT 与本地 Codex：local-first 协作流程

本文件只解释 `AGENTS.md` 的协作规则；长期规则以仓库根目录 `AGENTS.md` 为唯一真源。

## 一、核心模型

项目采用 **local-first 治理 + GitHub 正式治理**。这里的 local-first 是“当 ChatGPT 当前会话真实具备可信本地桥接/工作区时，优先在该工作区连续开发和验证，减少中间 push/Actions”；它**不**表示把普通开发交给 Codex。

```text
用户提出需求 / 反馈
    ↓
自动判断复用或新建 Issue
    ↓
独立 branch；当前 ChatGPT 实际具备可信本地工作区时，必要时独立 worktree
    ↓
ChatGPT 主导连续开发 + 最低测试矩阵中的适用验证
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

若当前网页端 ChatGPT没有本地桥接，则由 ChatGPT 继续使用 GitHub/云端工具开发，并尽量把中间修改批量形成少量 fixed candidate；不得因为缺少本地桥接而调用 Codex承担普通源码修改、测试、Git、PR 或 CI 工作。

本地优先不等于取消 GitHub。Issue、Draft PR、final Head review 和 main merge 仍是正式治理链路；只是中间小迭代不再以频繁 push 和 Actions 作为默认开发方法。

## 二、启动检查

使用本地 worktree 的会话先做：

1. 明确当前 worktree 绝对路径，并设置 `NEWSNOW_EXPECTED_ROOT`；
2. 运行 `AGENTS.md` 中的 Canonical Repository Identity Gate；
3. `git fetch origin`，读取最新 `origin/main:AGENTS.md`、`HANDOFF.md`、`PROGRESS.md`；
4. 核对 branch、HEAD、`git status --short`、实际 `origin/main`；
5. 读取当前 branch 对应的 Issue / PR；
6. 发现未知 dirty 状态、错误 repo、错误 worktree、不唯一 remote 或无法解释的并行变化时停止，不自动 reset/stash/clean。

所有 `gh` 命令显式绑定 `--repo caaaptaintop/newsnow`。

若当前 ChatGPT 没有本地 worktree/桥接，则不伪造上述本地事实；直接重新读取 GitHub 实际 `main`、当前 Issue/PR、branch Head、changed files 和并行修改后继续。

## 三、ChatGPT 与 Codex 分工

### ChatGPT

ChatGPT 是技术负责人、主要开发者和独立审查者，负责：

- 需求判断、架构和实现方案；
- 源码修改、缺陷修复；
- 测试设计与测试实现；
- Issue / branch / checkpoint / Draft PR / review 路由；
- 源码和 diff 审查；
- CI、Actions、artifact、部署日志审查；
- final Head、merge、部署和云端生产验收；
- 判断哪些事实确实必须从用户 Mac 获取。

只要 ChatGPT 当前工具、GitHub、CI、线上接口或其他已连接工具能够充分完成，就由 ChatGPT 直接完成。

### Codex：仅限不可替代的本机执行

只有同时满足以下三项，才进入 Codex：

1. ChatGPT 当前已有工具不能充分完成；
2. GitHub、CI、线上接口或其他已连接工具也不能充分完成；
3. 任务确实依赖用户 Mac 的文件、进程、登录态、浏览器、网络、launchd、私钥权限或其他本机事实。

典型范围：

- 本机生产副本、`.data`、日志和状态文件；
- launchd/plist、PID/PPID、锁、900 秒自然周期；
- 本机 CLI 登录态和私钥权限；
- 必须依赖本机 Chrome/桌面软件的真实交互；
- 用户 Mac 特有网络行为或本地原件采证。

Codex 默认先复现、观察和采证；发现代码问题时先回传证据，由 ChatGPT继续源码修改、测试、PR、review、merge 和部署。只有当前明确本机任务在必要范围内特别授权时，Codex 才可修改指定本机文件或执行指定 Git 操作；授权不得自行扩大。

这与 `docs/mac-subscription-batch.md` 保持一致：普通 GitHub 源码修改、PR、复审、合并和部署不能因为 local-first 而默认转交 Codex。

如果网页端 ChatGPT 没有本地桥接，它不能声称已经读取未 push commit、dirty diff 或本地测试日志。需要网页端正式 review 时，先把成果固定为 clean commit 并同步到 GitHub。

## 四、Issue、branch 与 worktree 自动编排

用户无需判断常规流程：

- 当前反馈属于原 Issue 验收目标、实现直接发现缺陷、必要测试/文档/范围内重构：复用原 Issue；
- 独立新功能、独立业务目标、显著改变验收范围、独立安全/数据/权限问题：新建 Issue；
- 每个独立 Issue 默认独立 branch；
- 只有当前 ChatGPT 实际具备可信本地工作区时，需要保留现场、并行开发或隔离未知 dirty 状态才编排独立 worktree；
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

若 ChatGPT 当前有可信本地/隔离执行环境，先运行适用测试和最终 diff 自审。只有满足以下条件才形成正式同步点：

- candidate 已固定；
- 若存在本地 worktree则必须 clean；
- 最低测试矩阵中的适用项已完成；
- 已知边界记录清楚；
- 没有未经解释的并行变化。

随后 push 并创建/更新同一 Draft PR。GitHub Actions 用于 fixed candidate 的共享验证，而不是每个微小中间状态的日常前置。没有本地执行能力时，ChatGPT可使用 GitHub/CI 完成必要验证；Codex不是普通测试执行器。

如果真实遇到 Actions 分钟、预算或其他额度错误：停止继续触发 Actions，保存原始错误并报告；不自行充值、提高预算或频繁 rerun。

## 六、独立 review

普通风险候选同步 GitHub 后，默认使用 fresh ChatGPT Web/context 对明确 SHA 做独立 review。review 必须实际查看 changed files、关键实现、最低测试矩阵的适用项、CI 和边界，不能只读 PR 描述或绿色状态。

发现问题后继续原 Issue、原 branch、同一 Draft PR 修复；形成新的 fixed Head 后重新 review。

涉及以下高风险时暂停自动 merge并升级审查：生产 D1/迁移/删除、鉴权/Access/密钥、发布协议和事务恢复、来源配置发布门禁、Mac worker/launchd/调度/锁/ledger/outbox、附件/正文持久化边界、不可逆生产写入、CI/部署门槛变更、治理/review 路由变化，以及本地与 GitHub 事实不一致。

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
