# ChatGPT 与本地 Codex 协作流程

本文件解释 `AGENTS.md` 中的长期协作规则。工程规则以仓库根目录 `AGENTS.md` 为唯一真源；本文件不作为第二套规则真源。

## 一、角色定位

本项目默认采用“ChatGPT 主导、Codex 本机执行”的分工。

### ChatGPT

ChatGPT 是默认技术负责人、主要开发者和独立审查者，负责：需求分析与技术方案、GitHub 仓库阅读和修改、缺陷定位与测试设计、分支/PR、CI/Actions/artifact 审查、独立复审、合并、云端部署与线上核验，以及判断哪些工作确实必须落到用户 Mac。

只要当前工具、GitHub、CI 或线上接口可以充分完成，就由 ChatGPT 直接完成，不把工作因为“Codex 也能做”而转交本机。

### 本地 Codex

Codex 是用户 Mac 上的受控执行器，只负责云端工具无法替代的本机事项，例如：

- 读取本地生产副本、`.data`、日志和状态文件；
- 检查 launchd、plist、PID/PPID、锁和真实 900 秒自然周期；
- 使用本机已有 CLI 登录态；
- 核对本机私钥文件权限和机器身份；
- 使用必须依赖本机 Chrome/Safari/桌面软件的真实交互；
- 采集无法从 GitHub/CI/线上接口取得的本机证据。

Codex 不默认承担下一轮代码开发。发现代码问题时优先复现并回传证据，之后由 ChatGPT 继续定位、修改、审查和推进 GitHub。

## 二、标准流转

普通功能或缺陷默认流转：

```text
用户提出需求
    ↓
ChatGPT 读取最新 main / AGENTS.md
    ↓
ChatGPT 分析、设计、修改 GitHub
    ↓
CI / 隔离验证
    ↓
ChatGPT 独立审查
    ↓
ChatGPT 合并、部署、云端验收
    ↓
如仍有本机独占事项 → 在相关 Issue/PR 发布 Codex 指令
    ↓
Codex 在同一 GitHub 线程回传本机证据
    ↓
ChatGPT 复审并决定下一步
```

如果全过程都能通过 GitHub、CI、线上接口和 ChatGPT 当前工具完成，则不应调用 Codex。

本机运行问题默认流转：

```text
用户反馈本机 worker / launchd / Chrome / CLI 问题
    ↓
ChatGPT 先检查仓库与云端状态
    ↓
确认确实必须依赖用户 Mac
    ↓
有直接相关 Issue/PR → 使用该线程
无直接相关线程 → 使用 HANDOFF.md 指定的备用交接 Issue
    ↓
ChatGPT 发布 [CHATGPT→CODEX][TASK <id>]
    ↓
Codex 只复现、观察或执行明确允许的本机动作
    ↓
Codex 发布 [CODEX→CHATGPT][TASK <id>]
    ↓
ChatGPT 独立复审并发布 [CHATGPT REVIEW][TASK <id>]
    ↓
如需改代码，由 ChatGPT 在 GitHub 推进
```

用户不作为常规文件中转站。默认不再要求用户把 Codex 证据 ZIP 下载后重新上传到 ChatGPT，也不要求用户反复复制长指令。

## 三、任务分派检查

ChatGPT 在准备给 Codex 指令前必须确认三点：

1. 当前 ChatGPT 工具不能充分完成；
2. GitHub、CI、线上接口、artifact 或隔离环境也不能充分完成；
3. 任务确实依赖用户本机文件、进程、登录态、浏览器或硬件环境。

只有前两项均不能充分完成且第三项为“是”，才进入 Codex。

典型分工：

| 任务 | 默认负责人 |
|---|---|
| 审查/修改 GitHub 源码 | ChatGPT |
| 新增测试、创建 PR | ChatGPT |
| 读取 CI/Actions 日志 | ChatGPT |
| 合并 PR、检查 Cloudflare 部署 | ChatGPT |
| 检查公开站接口 | ChatGPT |
| 查看 Mac 后台真实 HEAD | Codex |
| 查看 launchd 实际配置 | Codex |
| 观察 900 秒自然周期 | Codex |
| 检查本机 `.data` / outbox | Codex |
| 核对私钥文件权限 | Codex |
| 必须依赖本机浏览器的交互 | Codex |
| 本机问题触发的代码修复 | Codex 复现，ChatGPT 修改 |

## 四、代码开发规则

代码开发尽量由 ChatGPT 在 GitHub 推进：

1. 读取最新 `main`，确认并行修改；
2. 建立独立分支；
3. 先复现或补失败回归；
4. 做最小修复；
5. 运行与范围匹配的 CI / 构建 / 浏览器检查；
6. 审查实际 diff，而不是只看 CI 或 Codex 自报；
7. 阻断问题未解决则保留 PR；
8. 通过后锁定 Head SHA 合并；
9. 核对部署 SHA 和生产冒烟。

只有本机环境本身是缺陷触发条件时，Codex 才先做最小实验；即使如此，也优先回传失败证据，不自行扩大为开发任务。

## 五、GitHub 原生交接

### 1. 线程选择

优先级如下：

1. 当前已有功能 Issue/PR，且本机验证直接对应它：使用该线程；
2. 没有合适线程，且只是独立本机验证/运维采证：使用 `HANDOFF.md` 指定的备用交接 Issue；
3. 本机问题有独立生命周期、需要持续跟踪：由 ChatGPT 创建专用 Issue。

当前默认备用交接线程为 `Issue #72`，但具体指针以最新 `main` 的 `HANDOFF.md` 为准。

同一轮任务不重复建立多个交接线程。

### 2. 固定标记

- `[CHATGPT→CODEX][TASK <id>]`：ChatGPT 发布本机执行指令；
- `[CODEX→CHATGPT][TASK <id>]`：Codex 回传执行结果和原始证据；
- `[CHATGPT REVIEW][TASK <id>]`：ChatGPT 独立审查、问题分级和下一步结论。

Task ID 用于区分不同轮次。任何一方只看 GitHub 线程即可恢复任务上下文，不依赖聊天记录或用户手工转发附件。

### 3. Codex 开始前

Codex 应先在不扰动生产运行副本的前提下：

```sh
git fetch origin
git show origin/main:AGENTS.md
git show origin/main:HANDOFF.md
```

然后读取指定线程：

```sh
gh issue view <N> --repo caaaptaintop/newsnow --comments
# 或
gh pr view <N> --repo caaaptaintop/newsnow --comments
```

如果 `gh` 未认证、仓库不可访问、线程不可读写、Task ID 不匹配、基线 SHA 不一致或现场与指令冲突，Codex 应停止，不得用旧聊天猜测执行。

### 4. Codex 回传

Codex 优先生成临时、已脱敏的 Markdown 结果，然后直接写回同一线程：

```sh
gh issue comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
# 或
gh pr comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
```

回传至少包括：Task ID、时间/时区、实际 SHA、与任务相关的 PID/launchd 等事实、关键命令与退出码、关键日志摘录、文件元数据和 SHA-256（如适用）、before/after 状态、实际发生的写入，以及 unknown/失败/未验证边界。

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

因此“GitHub 原生交接”不是把所有本机文件都上传，而是让任务指令、可公开原始事实、哈希、日志摘录、审查结论和代码变化形成可追溯证据链。

只有 GitHub Issue/PR、Actions、PR diff、哈希和必要摘录仍不足以完成审查时，才例外要求用户手工上传文件本体。

## 七、Codex 指令格式

给 Codex 的任务必须是明确、封闭、最小化的本机操作包，不能写成“继续开发整个项目”。完整指令发布到对应 GitHub 线程；聊天里通常只需要告诉用户 Issue/PR 编号和 Task ID。

指令至少包含：

- 为什么必须在 Mac 执行；
- Task ID；
- 本机任务目标；
- 基线 SHA、时间/时区；
- 路径、进程或浏览器对象；
- 只读/可写边界；
- 禁止的生产动作；
- 需要回传的证据；
- 停止条件；
- GitHub 回传线程和格式。

默认禁止 Codex 自行扩大任务、修改生产 D1/调度、清历史状态、输出密钥、合并或部署，除非当前指令明确授权。

## 八、审查证据分级

最终结论明确区分：

- **独立确认**：ChatGPT 实际读源码、完整原始日志、重算或隔离实测；
- **证据支持**：读取了 Codex 原始日志、GitHub CI、Actions artifact 或其他可复核证据，但没有在审查端完整重跑；
- **仍待补证**：只有摘要、自报“通过”、缺少关键原件或环境不可用。

不得为了补历史证据重新操作生产数据。

## 九、当前产品保护边界

当前默认保持：仅公开 `building` 建筑主题；公开免登录；不开放访客账号、管理后台或访客 AI 设置；正常阅读和附件预览不触发 AI；持久层只保存元数据、摘要和原附件链接；不保存正文、完整 HTML 和附件文件；D1 不因测试重新初始化或重新迁移；Mac 后台保留既有 launchd 和自然周期；不新增第二套调度；不未经用户同意引入付费 API 或代理。

业务方向正式变化时先更新 `AGENTS.md`，再实施代码修改。

## 十、状态记录

- 长期规则：`AGENTS.md`
- 协作解释：本文件
- 接续入口与备用 Issue 指针：`HANDOFF.md`
- 动态状态和原始证据：对应 Issue / PR / Actions / artifact

不要维护多份内容近似但彼此不同的规则文件。`HANDOFF.md` 只保存接续所需的最小入口和指针，不堆积大日志。

## 十一、网页端 ChatGPT 项目指令同步

网页端项目指令至少声明：ChatGPT 是默认技术负责人和主要开发者；Codex 只处理必须依赖本机的事项；GitHub/CI/线上工具能完成的工作不得转交 Codex；Codex 结果必须回到 ChatGPT 独立复审；本机指令和证据默认通过 GitHub Issue/PR 交接；用户不承担常规文件中转；工程规则真源为仓库根目录 `AGENTS.md`。

网页项目指令不要保存快速变化的 commit SHA、文章数量或单次 PR/CI 状态。