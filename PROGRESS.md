# 当前阶段：Issue #93 建筑单栏目与取消标签本地候选已固定

已核验 canonical 仓库与 main 1f82ed6 基线。建筑公开读取只按主栏目计数和筛选；旧 relatedCategories 不再让同一文章出现在其他栏目。“全部信息”仍汇总全部已发布。建筑页不再显示顶部快捷标签、标签下拉和卡片标签；遗留 URL tags 参数不造成隐藏筛选。未来建筑 AI 分类只输出一个主栏目，relatedCategories 与 tags 规范化为空；其他主题规范化与安全校验保持原行为。未迁移历史数据，未改 D1。

定向回归 71 项通过（building-platform 27、intelligence 33、ai-provider 11）。改动文件 eslint 0 error（building.tsx 保留 hooks 依赖警告）；改动文件 typecheck 无新增错误。全库 lint/typecheck 历史诊断仍在，不声称全库通过。主 agent pnpm build 通过（.local/single-category-93/build.log）。Tabbit 已完成桌面与 390 手机验收：无标签 UI、遗留 tags=BIM 不隐藏结果、手机无横向溢出；证据见 .local/single-category-93/browser-verification.md。正文可行性只读调查见 body-feasibility.md，本任务未改正文链路。

本地 Head 3c6ccf8786945c6b109e97d1dc8d6a140f2e8eed，pre-commit lint-staged 已通过。按入口登记的 Issue85 已授权但未合并候选规则执行普通变更自审。未 push、未合并、未部署。
