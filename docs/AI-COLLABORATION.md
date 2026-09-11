# ChatGPT 与本地 Codex 协作流程

本文件用于解释 `AGENTS.md` 中的长期协作规则。工程规则以仓库根目录 `AGENTS.md` 为准；本文件不作为第二套规则真源。

## 一、角色定位

本项目默认采用“ChatGPT 主导、Codex 本机执行”的分工。

### ChatGPT

ChatGPT 是默认技术负责人、主要开发者和独立审查者，负责：

- 需求分析与技术方案；
- GitHub 仓库阅读、搜索和修改；
- 缺陷定位、测试设计和修复；
- PR、CI、Actions、artifact、部署日志审查；
- 代码复审、合并和云端上线核验；
- 判断哪些工作确实必须落到用户 Mac；
- 审查 Codex 回传的本机结果并决定下一步。

### 本地 Codex

Codex 是用户 Mac 上的受控执行器，只负责云端工具无法替代的本机事项，例如：

- 读取本地生产副本、`.data`、日志和状态文件；
- 检查 launchd、plist、PID、锁和真实 900 秒自然周期；
- 使用本机已有 CLI 登录态；
- 核对本机私钥文件权限和机器身份；
- 使用用户本机 Chrome 或桌面软件做必须依赖本机环境的验证；
- 采集未上传的本机证据。

Codex 不默认承担“下一轮代码开发”。发现代码问题时，应优先复现并回传证据，之后由 ChatGPT 继续定位、修改、审查和推进 GitHub。

## 二、标准流转

### 1. 普通功能或缺陷

```text
用户提出需求
    ↓
ChatGPT 分析需求与当前仓库状态
    ↓
ChatGPT 直接读取 GitHub 源码
    ↓
ChatGPT 创建分支并修改代码
    ↓
CI / 隔离测试
    ↓
ChatGPT 独立审查
    ↓
ChatGPT 合并与云端部署检查
    ↓
如仍有本机独占事项 → 在相关 Issue/PR 发布 Codex 指令
    ↓
Codex 直接在同一 GitHub 线程回传本机证据
    ↓
ChatGPT 复审并决定下一步
```

如果全过程都可以通过 GitHub、CI、线上接口和 ChatGPT 现有工具完成，则不应调用 Codex。

### 2. 本机运行问题

```text
用户反馈本机 worker / launchd / Chrome / CLI 问题
    ↓
ChatGPT 先检查仓库和云端状态
    ↓
确认问题必须依赖用户 Mac
    ↓
有对应功能 Issue/PR → 使用该线程
无对应线程 → 使用 HANDOFF.md 指定的备用交接 Issue
    ↓
在该线程发布 [CHATGPT→CODEX][TASK <id>] 指令
    ↓
Codex 只复现、观察或执行明确的本机动作
    ↓
Codex 在同一线程发布 [CODEX→CHATGPT][TASK <id>] 原始结果
    ↓
ChatGPT 独立复审并发布 [CHATGPT REVIEW][TASK <id>]
    ↓
如需改代码，由 ChatGPT 在 GitHub 推进
```

用户不作为常规文件中转站。默认不再要求用户把 Codex 证据 ZIP 下载后重新上传到 ChatGPT。

## 三、任务分派检查表

ChatGPT 在准备给 Codex 指令前，必须先问三件事：

1. 这件事能否直接通过 ChatGPT 当前工具完成？
2. GitHub、CI、线上接口、artifact 或隔离环境能否充分完成？
3. 是否确实需要用户本机文件、进程、登录态、浏览器或硬件环境？

只有前两项均不能充分完成且第三项为“是”，才进入 Codex。

典型判断：

| 任务 | 默认负责人 |
|---|---|
| 审查 PR 源码 | ChatGPT |
| 修改 GitHub 源码 | ChatGPT |
| 新增测试 | ChatGPT |
| 创建 PR | ChatGPT |
| 读取 CI 日志 | ChatGPT |
| 合并 PR | ChatGPT |
| 检查 Cloudflare 部署 | ChatGPT |
| 检查公开站接口 | ChatGPT |
| 对比 D1 导出的可审查证据 | ChatGPT |
| 查看 Mac 后台真实 HEAD | Codex |
| 查看 launchd 实际配置 | Codex |
| 观察 900 秒自然周期 | Codex |
| 检查本机 `.data` / outbox | Codex |
| 核对私钥文件权限 | Codex |
| 必须依赖本机 Chrome 的交互 | Codex |
| 本机问题的代码修复 | 先 Codex 复现，ChatGPT 修改 |

## 四、代码开发规则

代码开发应尽量在 GitHub 上由 ChatGPT 推进：

1. 读取最新 `main`，确认没有与其他工作冲突；
2. 建立独立分支；
3. 先复现或补失败测试；
4. 做最小修复；
5. 运行与范围匹配的 CI / 构建 / 浏览器检查；
6. 审查实际 diff，而不是只看 Codex 或 CI 的“通过”；
7. 发现阻断问题则保留 PR，不合并；
8. 通过后锁定 Head SHA 合并；
9. 核对真实部署 SHA 和部署后生产检查。

只有本机环境是缺陷触发条件本身时，Codex 才可以先做最小实验。即使如此，也应优先回传失败证据，而不是自行扩大修复。

## 五、GitHub 原生交接

### 1. 交接线程怎么选

优先级如下：

1. 当前已有功能 Issue/PR，且本机验证直接对应该线程：使用该线程；
2. 当前没有合适线程，且只是独立本机验证/运维采证：使用根目录 `HANDOFF.md` 指定的备用交接 Issue；
3. 本机问题有独立生命周期、需要持续跟踪：由 ChatGPT 创建专用 Issue。

当前备用交接线程为 Issue #72，但具体指针以最新 `main` 的 `HANDOFF.md` 为准。

同一轮任务不重复建立多个交接线程。

### 2. 三种固定标记

- `[CHATGPT→CODEX][TASK <id>]`：ChatGPT 发布本机执行指令；
- `[CODEX→CHATGPT][TASK <id>]`：Codex 回传执行结果和原始证据；
- `[CHATGPT REVIEW][TASK <id>]`：ChatGPT 独立审查、问题分级和下一步结论。

Task ID 用于在交接线程的评论中区分不同轮次。这样任何一方只看 GitHub Issue/PR 即可恢复上下文，不依赖聊天记录或用户手工转发附件。

### 3. Codex 开始前的读取顺序

Codex 应先在不扰动生产运行副本的前提下执行：

```sh
git fetch origin
git show origin/main:AGENTS.md
git show origin/main:HANDOFF.md
```

然后读取 ChatGPT 指定的 Issue/PR，或 `HANDOFF.md` 中的备用交接 Issue：

```sh
gh issue view <N> --repo caaaptaintop/newsnow --comments
# 或
gh pr view <N> --repo caaaptaintop/newsnow --comments
```

如果 `gh` 未认证、仓库不可访问、目标线程不可读写、Task ID 不匹配或最新指令与本机状态冲突，Codex 应停止，不得用旧聊天中的大段指令猜测执行。

### 4. Codex 回传方式

正常情况下，Codex 直接写回同一 GitHub 线程：

```sh
gh issue comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
# 或
gh pr comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
```

回传至少包括：

- Task ID；
- 时间和时区；
- 实际仓库/运行副本 SHA；
- 执行对象、PID/PPID/launchd 状态等与任务相关事实；
- 关键命令与退出码，敏感参数必须删去；
- 关键日志摘录；
- 文件路径、大小、mtime、SHA-256（如适用）；
- before/after 状态；
- 发生过的写入；
- unknown、失败项和未验证边界。

Codex 自报“通过”不能替代这些原始事实。

## 六、证据放在哪里

| 证据类型 | 默认位置 |
|---|---|
| 少量文本、状态、命令输出、日志摘录 | 对应 Issue/PR 评论 |
| 源码、测试、fixture、文档 | 功能分支 + PR |
| CI/构建/自动化结果 | GitHub Actions run / log / artifact |
| 较大但非敏感且确需保留的证据 | Actions artifact 或 GitHub 可审查附件 |
| 本机敏感或不宜上传的原件 | 留在 Mac，仅回传路径、元数据、SHA-256、必要脱敏摘录 |

禁止把真实密钥、Token、Cookie、密码、私钥内容、浏览器敏感数据、原始生产数据库、禁止持久化的正文/完整 HTML/附件字节上传 GitHub。

因此“GitHub 原生交接”不是把所有本机文件都上传，而是让**任务指令、可公开原始事实、哈希、日志摘录、审查结论和代码变化**都在 GitHub 上形成可追溯证据链。

只有 GitHub Issue/PR、Actions、PR diff、哈希和必要摘录仍不足以完成审查时，才例外要求用户手工上传文件本体。

## 七、Codex 指令应短而封闭

给 Codex 的任务应是明确的本机操作包，而不是“继续开发整个项目”。完整指令应发布到对应 Issue/PR；聊天里通常只需要给用户一个 Issue/PR 链接/编号和 Task ID。

合格指令应包含：

- 为什么必须在 Mac 执行；
- 本机任务目标；
- Task ID；
- 基线 SHA、时间/时区；
- 具体目录、进程或浏览器对象；
- 只读/可写边界；
- 禁止的生产动作；
- 需要保存/回传的证据；
- 停止条件；
- GitHub 回传线程和格式。

示例：

```text
[CHATGPT→CODEX][TASK worker-natural-cycle-001]
只核验现有 launchd worker 是否已经自然采用 main 的指定提交。
不得 kickstart、bootout/bootstrap、手动运行 worker、缩短 900 秒间隔、
删除锁/队列、修改 D1 或切换生产仓库分支。
记录两个连续自然周期的 startedAt/finishedAt、HEAD、PID、exit、outbox、
版本变化和新增/修改 ID，并直接回传到指定 GitHub 线程；本机敏感原件只回传 SHA-256 与必要摘录。
```

不合格指令包括：

```text
请继续检查项目并修复所有问题，然后开 PR、合并和部署。
```

这种工作应留在 ChatGPT。

## 八、审查证据怎么说

最终结论必须说明证据层级。

### A. 独立确认

ChatGPT 自己读源码、完整原始日志、重算数据或在隔离环境实际运行。

可写：

> 独立读取源码确认。

> 审查端实际复现并验证通过。

### B. 证据支持

只读取了 Codex 原始日志、GitHub CI、Actions artifact 或其他可复核证据，但没有在审查端完整重跑。

可写：

> 依据 GitHub 原始证据支持。

> 已读取 GitHub CI 完整日志确认该项成功。

不能把它写成 ChatGPT 自己跑过。

### C. 仍待补证

缺历史原件、只有摘要、浏览器环境不可用等。

应直接保留：

> 当前仍待补证，不作为已通过项。

不得为了补历史证据重新操作生产数据。

## 九、当前产品保护边界

当前阶段默认保持以下原则：

- 仅公开 `building` 建筑主题；
- 公开免登录；
- 不开放访客账号、管理后台或访客 AI 设置；
- 正常阅读和附件预览不触发 AI；
- 持久层只保存元数据、摘要和原附件链接；
- 不保存正文、完整 HTML 和附件文件；
- D1 不因测试重新初始化或重新迁移；
- Mac 后台保留原 launchd 调度和自然周期；
- 不新增第二套调度；
- 不未经用户同意引入付费 API 或代理。

如业务方向正式变化，应先更新 `AGENTS.md`，再实施代码修改。

## 十、状态记录

长期规则：`AGENTS.md`。

解释流程：本文件。

接续入口和备用交接 Issue 指针：`HANDOFF.md`。

动态状态和原始证据：对应 Issue / PR / Actions / artifact。

不要再维护多份内容近似但彼此不同的“规则文件”。`HANDOFF.md` 只记录接续所需的最小入口和协议，不复制长期规则，也不堆积大段日志。

## 十一、网页端 ChatGPT 项目指令同步

网页端项目指令应至少声明：

- ChatGPT 是默认技术负责人和主要开发者；
- Codex 只处理必须依赖本机的事项；
- 能由 GitHub/CI/线上工具完成的工作不得转交 Codex；
- Codex 结果必须回到 ChatGPT 独立复审；
- 本机指令和证据默认通过相关 Issue/PR 或 `HANDOFF.md` 指定的备用交接 Issue 交接，用户不承担常规文件中转；
- 项目工程规则真源为仓库根目录 `AGENTS.md`；
- 长期规则发生变化时，同时更新网页端项目指令与 `AGENTS.md`。

网页项目指令不要保存快速变化的 commit SHA、文章数量或单次 PR 状态，这些应放在当前会话、Issue/PR 或阶段验收记录中。