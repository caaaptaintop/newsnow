# 个人信息情报站：开发接续入口

本文件只记录当前接续现场，不是长期规则真源。长期规则读 `AGENTS.md`，阶段状态读 `PROGRESS.md`，协作说明读 `docs/AI-COLLABORATION.md`，Mac 生产运维读 `docs/mac-subscription-batch.md`。

## 当前治理现场

- 当前治理 Issue：#77 `开发流程迁移：local-first + AI Cube 同款自动编排`
- 当前 Draft PR：#78 `chore: migrate development workflow to local-first`
- 活跃 branch：`chore/newsnow-local-first-workflow-20260912`
- PR #78 初始 branch 基线早于 PR #76；继续开发前已经重新读取实际 `main`，并以双父 merge commit 把 PR #76 的已上线实现和治理分支合并到同一候选。正式 review 必须以 GitHub 当前实际 Head 为准，不在本文件硬编码“最终 SHA”。
- 首轮 fresh independent review 对固定 Head 提出 2 个 P1 blocker 和 1 个 P2 hardening：Codex 职责扩大、最低测试矩阵丢失、HTTPS userinfo 未 fail-closed。修复继续使用原 Issue/branch/PR，形成新 fixed Head 后重新 fresh review。
- fixed candidate、正式 review 和 merge 候选要求 clean worktree；只有 ChatGPT 当前会话真实具备本地 worktree/桥接时才记录本地 clean/dirty。没有本地桥接时明确标记 `N/A`，不得伪造本地事实。
- 下一同步点：当前修复形成一个新的 fixed candidate，完成适用验证后更新同一 Draft PR；随后重新执行 fresh independent review。

## 已收尾的迁移前产品线

Issue #74 / PR #76 的住建部动态列表与分页适配已完成最终代码复审、合并和生产发布。其产品事实链继续保留在 #74/#76，不迁入 #77。当前仍保留的边界是：Cloudflare 对住建部的 530/1016 网络环境问题本身没有消失；系统通过严格的签名 Mac runtime fallback 和独立 `runtime-source-test` capability 保持发布门禁。是否/何时关闭 #74 应按该 Issue 的剩余目标决定，不用流程迁移重写历史结论。

## local-first 交接字段

每次阶段交接至少记录：

- 当前 Issue：
- 活跃 branch：
- 明确 worktree 根（仅当当前 ChatGPT 实际具备可信本地工作区；否则 `N/A`）：
- base SHA：
- candidate Head：
- worktree clean/dirty（无本地桥接时 `N/A`）：
- 本地/隔离测试列表：
- 本地原生证据（如适用）：
- 已同步到 GitHub 的最后 SHA：
- 当前 Draft PR：
- 未验证/阻断项：
- 下一同步点：

开发中的未 push 事实只有在当前 ChatGPT 实际接入同一可信本地 worktree 时才可作为权威；网页端没有本地桥接时不能声称看见 dirty diff 或本地测试。正式网页 review 必须先固定 clean commit 并同步到 GitHub。

## Session bootstrap

若当前任务使用本地 worktree：

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

如果当前 ChatGPT 没有本地 worktree/桥接，则不调用 Codex去“补齐 local-first”。ChatGPT 直接重新读取 GitHub 实际 `main`、当前 Issue/PR、branch Head、changed files 与并行提交，并使用自身 GitHub/云端工具推进。

## GitHub 同步策略

小迭代不为每一步 push。达到 clean fixed candidate、完成范围匹配的最低测试矩阵和 diff 自审后，才 push/更新当前 branch 与同一 Draft PR。普通 review 针对明确 GitHub SHA；发现问题继续原 Issue/branch/PR 修复，再形成新的 fixed Head。

Actions 用于 fixed candidate 的共享验证，不是每个中间状态的日常前置。若实际遇到 Actions 额度/预算阻断，停止新增 Actions 消耗并原样报告，不自行充值、提高预算或反复 rerun。测试种类和触发条件仍以 `AGENTS.md` 的最低测试矩阵为准，不能因为减少 Actions 频率而删减验证。

## Codex 调用门与本机证据总线

Codex 只处理确实依赖用户 Mac 的事项。只有同时满足以下三项才下发 Codex 任务：

1. ChatGPT 当前工具不能充分完成；
2. GitHub、CI、线上接口或其他已连接工具也不能充分完成；
3. 任务确实依赖用户 Mac 的文件、进程、登录态、浏览器、网络、launchd、私钥权限或其他本机事实。

普通源码修改、测试设计与实现、branch/PR、CI 审查、review、merge、部署不因 local-first 而默认转交 Codex。Codex 发现代码问题默认先复现和回传证据，后续源码修改仍由 ChatGPT 推进，除非当前明确本机任务在必要范围内特别授权。

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

ChatGPT 负责需求、架构、实现方案、源码修改、测试设计与实现、GitHub 治理、源码/diff 审查、review、merge、部署和云端验收。local-first 仅在 ChatGPT 自身真实具备可信本地桥接/工作区时改变开发执行位置；否则继续由 ChatGPT 使用 GitHub/云端工具。Codex 始终是本机独占事项的受控执行器，不因为流程迁移成为普通开发代理。
