# Issue101：六专栏、AI初筛及AGY正式接入
目标：原标题保留，新闻/活动/政策按实质归六技术专栏，整页已处理才停翻页，AGY标题和正文均low。
阶段：用户已确认待AGY接入后一并发布；当前AGY正式调用已实现，候选复核与发布中。
工作区：/Users/imac/Projects/newsnow-schedule-manual；codex/ai-title-screening；PR102（发布状态以GitHub为准）。
已完成：六专栏/语义初筛/候选队列/多版本去重/采集结果统计及原标题保护。
已完成：AGY独立项目加载deny-all hook；正文仅父进程内存，通过本地socket在身份持久登记后注入。
留存：成功、超时、SIGKILL恢复均按owned UUID清理；活AGY拒绝清理；SIGKILL/停机遗留由下次启动恢复。
验证：正式provider 8合成正文8/8；中文跨块传输与隔离清理5项通过；全库/构建/固定提交终核进行中。
运行：项目专用agy-1.2.2固定hash，位于~/Library/Application Support/CapxNewsNow/bin，不改全局AGY；无Codex回退。
边界：不保存真实正文作证据，不删除其他AGY会话；PDF/附件/来源与05/12/16调度不变。
未完成：固定候选独立终核、CI、合并部署、生产AGY采集及线上结果验证。
下一动作：完成上述发布核验，明确任何真实生产失败，不将本地测试冒充上线。
