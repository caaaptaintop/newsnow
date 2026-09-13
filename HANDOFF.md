# Issue #93：建筑单栏目与取消标签（本地候选）
目标：每篇文章只按主栏目计数/筛选；建筑页取消标签展示与筛选。
阶段：本地候选已固定 3c6ccf8786945c6b109e97d1dc8d6a140f2e8eed；未 push/merge/deploy。
基线：main 1f82ed60346830e496ed833a4c0c612f155ef088。
已完成：主栏目计数/筛选；遗留 tags 不筛选；建筑 AI 只输出单栏目且 tags 为空。
已完成：定向回归 71 项通过；改动文件 eslint 0 error；主 agent pnpm build 通过。
已完成：Tabbit 桌面与 390 手机验收，见 .local/single-category-93/browser-verification.md。
未完成：未推送、未合并、未部署。
验证入口：test/building-platform.test.ts、test/intelligence.test.ts。
风险：历史 relatedCategories/tags 仍存协议字段；全库 lint/typecheck 历史诊断仍在。
审查：普通可逆产品改动，按已授权 Issue85 候选规则自审。
下一动作：交付本地候选；远端同步按明确同步点推进。
