# Issue #88：附件发送生命周期整改（PENDING）
目标：修复独立审查P1，保持既有授权、限流与回源边界。
阶段：统一75秒截止的第二轮整改验证完成，尚未形成新固定候选。
基线：13d0c3ee82497742dd839266bf560c288d99e76e；branch codex/attachment-preview-cache-88。
已完成：Cloudflare从slot占用起统一截止，覆盖D1/缓存/读取/发送；晚到响应取消，晚到lease补结算。
已完成：保留上轮Mac发送生命周期及两处P2文档修复。
验证：104项定向回归通过；本轮5项核心回归在修复前dirty快照独立失败；生产构建通过。
验证入口：.local/attachment-88/revision-deadline/；docs/attachment-preview.md。
风险：历史ESLint/全库类型检查仍未通过；此前一次性hook豁免不适用于本轮。
未完成：新固定Head、原独立任务增量复审、正式Tunnel和生产端到端验收。
归属：本任务本地未提交修改；无推送/合并/部署/生产写入。
下一动作：保留整改diff；满足提交门槛后固定Head，再交原独立审查任务复审。
