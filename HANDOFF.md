# 个人信息情报站：ChatGPT ↔ Codex 交接入口

本文件是接续入口，不是长期规则真源，也不是大日志仓库。

- 长期工程规则：`AGENTS.md`
- 协作流程说明：`docs/AI-COLLABORATION.md`
- Mac 运维边界：`docs/mac-subscription-batch.md`
- 实际任务指令、原始证据和审查结论：对应 GitHub Issue / PR / Actions

## 1. 默认交接方式

本项目不再默认让用户在 ChatGPT 与本机 Codex 之间手工下载、上传或转发证据包。

需要本机执行时：

1. ChatGPT 选择当前相关的 GitHub Issue/PR；没有合适线程时新建 Issue。
2. ChatGPT 在该线程发布 `[CHATGPT→CODEX]` 完整指令。
3. Codex 从 GitHub 读取该指令，仅执行明确允许的本机操作。
4. Codex 在同一线程发布 `[CODEX→CHATGPT]`，附可复核的原始事实、日志摘录、SHA/哈希和 unknown。
5. ChatGPT 独立读取源码、GitHub 证据和必要线上状态，发布 `[CHATGPT REVIEW]` 并继续修改、PR、合并、部署或下一轮本机验证。

用户通常只需要把 Issue/PR 编号或链接交给本机 Codex，不需要搬运文件。

## 2. Codex 每次开始前

在不 checkout/reset/pull 正在运行的生产副本、不扰动 worker 的前提下，先读取远端规则：

```sh
git fetch origin
git show origin/main:AGENTS.md
git show origin/main:HANDOFF.md
```

再读取 ChatGPT 指定的线程：

```sh
gh issue view <N> --repo caaaptaintop/newsnow --comments
# 或
gh pr view <N> --repo caaaptaintop/newsnow --comments
```

只执行最新、未被后续评论替代的 `[CHATGPT→CODEX]` 指令。

如果 `gh auth status` 失败、仓库不可访问、基线 SHA 不一致、现场与指令冲突或执行将触碰禁止边界，应停止并报告，不凭历史聊天猜测。

## 3. Codex 回传格式

优先生成一个临时、已脱敏的 Markdown 结果，再直接发到同一线程：

```sh
gh issue comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
# 或
gh pr comment <N> --repo caaaptaintop/newsnow --body-file <sanitized-result.md>
```

正文建议按以下结构：

```text
[CODEX→CHATGPT]

时间/时区：
执行对象：
实际 SHA / PID / launchd 状态：
执行动作与退出码：
关键原始证据：
文件元数据 / SHA-256：
前后状态差异：
发生的写入：
失败 / unknown / 未验证边界：
```

不得只写“完成”“通过”或只给一个本机文件路径。

## 4. 证据路由

- 小型文本、状态、命令输出、日志摘录 → Issue/PR 评论；
- 源码、测试、fixture、文档 → 功能分支 + PR；
- CI/构建结果 → GitHub Actions run / log / artifact；
- 较大但非敏感、确需保存的证据 → Actions artifact 或 GitHub 可审查附件；
- 敏感或不宜上传的本机原件 → 保留 Mac，仅在 GitHub 回传路径、大小、mtime、SHA-256 与必要脱敏摘录。

禁止上传真实密钥、Token、Cookie、密码、私钥内容、浏览器敏感数据、原始生产数据库，以及项目规则禁止持久化的正文、完整 HTML、附件字节。

只有 GitHub 线程、Actions、PR diff、哈希和必要摘录仍不足以完成审查时，才例外由 ChatGPT 明确要求文件本体。

## 5. 职责边界

Codex 的 GitHub 写入默认仅限：

- 在被指定的 Issue/PR 回传本机结果；
- 若 ChatGPT 明确授权，推送指定分支上的本机专属修改。

Codex 不因获得 GitHub 写权限而自动取得架构决策、代码重构、PR 合并、部署、生产 D1 写入或调度变更权限。上述事项仍由 ChatGPT 负责分析、修改和审查，除非当前 `[CHATGPT→CODEX]` 指令明确授权。
