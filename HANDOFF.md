# 个人信息情报站：开发接续入口
本文件只记录当前阶段增量；长期规则见 `AGENTS.md`，阶段状态见 `PROGRESS.md`。
- 当前治理 Issue：#79 `修正 local-first / codex-chatgpt-web 职责与 review routing`。
- 当前阶段：在独立本地 worktree 修正五份治理文档，尚未 push、尚未创建本 Issue Draft PR。
- 明确 worktree：`/Users/imac/Projects/newsnow-issue-79`；活跃 branch：`codex/newsnow-local-first-correction-79`。
- base：GitHub `main` 与 `origin/main` 已核对一致；具体 SHA 以当前 Git 实测和 Issue/PR 证据为准。
- Compatibility V1 只读探针已由用户提供为通过；继续开发时 Web 模型与 Codex 工具层必须绑定同一明确 worktree。
- 本轮允许修改仅 `AGENTS.md`、`HANDOFF.md`、`PROGRESS.md`、`docs/AI-COLLABORATION.md`、`docs/mac-subscription-batch.md`。
- 验证门：完整最终 diff、`git diff --check`、五文件交叉一致性、Identity Gate/最低测试矩阵/生产保护与 base 的确定性对照。
- #77/#78 仅保留为此前治理迁移与审查历史，不复用其旧活动 Issue/PR、旧 blocker 或未完成状态。
- candidate Head：完成本轮验证后由当前 branch 的实际 clean commit 固定；本文件不硬编码自引用 SHA。
- 下一同步点：外层 push clean candidate、创建引用 #79 的 Draft PR 并路由 fresh independent Web review；治理变更审查通过前不 merge。
