# Issue #93：建筑单栏目与取消标签（本地候选）
目标：每篇文章只按主栏目计数/筛选；建筑页取消标签展示与筛选。
阶段：实现、定向回归与自审完成；本提交固定本地候选。
基线：main 1f82ed60346830e496ed833a4c0c612f155ef088。
已完成：读取端只匹配 category；relatedCategories 不再跨栏计数或命中。
已完成：建筑页去掉快捷标签、标签下拉与卡片标签；遗留 tags 参数不再筛选。
已完成：建筑 AI 规范化只保留一个主栏目，relatedCategories/tags 为空；其他主题行为未改。
未完成：未推送、未合并、未部署；本任务未要求远端同步或生产操作。
验证入口：test/building-platform.test.ts、test/intelligence.test.ts。
风险：历史 relatedCategories/tags 仍存协议字段；全库 lint/typecheck 历史诊断仍在，不属本任务清零。
审查：普通可逆产品改动，按已授权 Issue85 候选规则自审；未改 D1/采集/附件/PDF。
归属：当前开发任务独占 Issue93 分支。
下一动作：交付本地候选；远端同步按明确同步点推进。
