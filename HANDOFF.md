# 个人信息情报站：开发接续入口

本文件只记录当前接续现场，不是长期规则真源。长期规则读 `AGENTS.md`，阶段状态读 `PROGRESS.md`，协作说明读 `docs/AI-COLLABORATION.md`，Mac 生产运维读 `docs/mac-subscription-batch.md`。

## 当前治理现场

- 当前治理 Issue：#77 `开发流程迁移：local-first + AI Cube 同款自动编排`
- 当前 Draft PR：#78 `chore: migrate development workflow to local-first`
- 活跃 branch：`chore/newsnow-local-first-workflow-20260912`
- PR #78 初始 branch 基线早于 PR #76；继续开发前已经重新读取实际 `main`，并以双父 merge commit 把 PR #76 的已上线实现和新治理规则合并到同一候选。正式 review 必须以 GitHub 当前实际 Head 为准，不在本文件硬编码“最终 SHA”。
- fixed candidate、正式 review 和 merge 候选要求 clean worktree；本地有未同步事实时必须明确记录 clean/dirty 和已同步 SHA。
- 下一同步点：PR #78 当前 Head 完成规则/diff 独立审查；发现问题继续原 Issue/branch/PR 修复，形成新的 fixed Head 后再 review。

## 已收尾的迁移前产品线

Issue #74 / PR #76 的住建部动态列表与分页适配已完成最终代码复审、合并和生产发布。其产品事实链继续保留在 #74/#76，不迁入 #77。当前仍保留的边界是：Cloudflare 对住建部的 530/1016 网络环境问题本身没有消失；系统通过严格的签名 Mac runtime fallback 和独立 `runtime-source-test` capability 保持发布门禁。是否/何时关闭 #74 应按该 Issue 的剩余目标决定，不用流程迁移重写历史结论。

## local-first 交接字段

每次阶段交接至少记录：

- 当前 Issue：
- 本地活跃 branch：
- 明确 worktree 根：
- base SHA：
- candidate Head：
- worktree clean/dirty：
- 本地测试列表：
- 本地原生证据：
- 已同步到 GitHub 的最后 SHA：
- 当前 Draft PR：
- 未验证/阻断项：
- 下一同步点：

开发中的未 push 事实以本地现场为权威；网页端没有本地桥接时不能声称看见 dirty diff 或本地测试。正式网页 review 必须先固定 clean commit 并同步到 GitHub。

## Session bootstrap

新的本地开发会话先：

1. 设置 `NEWSNOW_EXPECTED_ROOT` 为任务明确指定的绝对 worktree；
2. 运行 `AGENTS.md` 的 Repository Identity Gate；
3. 读取最新远端：

```sh
git fetch origin
git show origin/main:AGENTS.md
git show origin/main:HANDOFF.md
git show origin/main:PROGRESS.md
```

4. 检查 `git status --short`、branch、HEAD、实际 `origin/main`；
5. 读取当前 Issue/PR；所有 `gh` 操作显式使用 `--repo caaaptaintop/newsnow`。

身份、worktree、remote、当前 Issue/PR 或未知 dirty 状态无法唯一确认时 fail-closed；不得自动 reset/stash/clean、修改 remote、切换到猜测目录或覆盖未知文件。

## GitHub 同步策略

本地小迭代不为每一步 push。达到 clean fixed candidate、完成范围匹配的本地测试和 diff 自审后，才 push 到当前 branch 并创建/更新同一 Draft PR。普通 review 针对明确 GitHub SHA；发现问题继续原 Issue/branch/PR 修复，再形成新的 fixed Head。

Actions 用于 fixed candidate 的共享验证，不是每个中间状态的日常前置。若实际遇到 Actions 额度/预算阻断，停止新增 Actions 消耗并原样报告，不自行充值、提高预算或反复 rerun。

## 本机任务与证据总线

有直接相关功能 Issue/PR 时，本机任务使用该线程。没有直接线程的独立本机验证、运维采证、CLI/浏览器/launchd 任务继续使用：

- Issue #72 `ChatGPT ↔ Codex 本机任务交接总线`
- https://github.com/caaaptaintop/newsnow/issues/72

固定标记：

- `[CHATGPT→CODEX][TASK <id>]`
- `[CODEX→CHATGPT][TASK <id>]`
- `[CHATGPT REVIEW][TASK <id>]`

Codex 回传至少包括时间/时区、实际 repo/HEAD、执行对象、关键命令和退出码、before/after、发生的写入、证据路径/元数据/SHA-256、失败/unknown。不得只写“完成/通过”。

小文本和日志摘录放 Issue/PR；代码/测试/fixture/文档走 branch + PR；CI 证据走 Actions；敏感本机原件留 Mac，只回传最小脱敏摘录与哈希。不得上传密钥、Token、Cookie、密码、私钥、原始生产数据库、完整正文/HTML 或附件字节。

## 职责边界

ChatGPT 负责需求、架构、实现方案、测试设计、GitHub 治理、源码/diff 审查、review、merge、部署和云端验收。Codex 在 local-first 中是本地工具层，按明确方案执行文件/Git/Shell/测试/GUI/macOS 操作与事实采集，不自行扩大为架构重构、独立功能、生产 D1 修改、调度修改、merge 或部署，除非当前明确任务授权。
