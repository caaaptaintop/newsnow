# Issue101：六个技术专栏、AI初筛与Antigravity评估
目标：减少标题漏召回，新闻/会议/活动/政策/标准归六个技术专栏，整页已处理才停翻页。
阶段：用户已确认预览并要求发布；AGY 3.8 Flash low标题/正文接入仍有隔离阻断，不能冒充完成。
工作区：/Users/imac/Projects/newsnow-schedule-manual；codex/ai-title-screening；统计基线517a4d8。
已完成：删除综合政策与标准栏目；不设建设要闻栏目；单篇单专项；同步标题/正文提示词。
已完成：标题low及正文low均8/8收录/分类与high一致；正文low两批一次成功8.6–12.2秒，仅合成短文。
验证：全库465项、worker4项通过；多版本整改31定向+实际CLI四轮恢复通过，独立增量复核PASS。
预览：http://127.0.0.1:4199/；.local/antigravity/comparison-low-body.json为最新强度对比，真实正文未输入AGY。
边界：AGY仅evaluation入口，未接mac-batch；工具列表限制未生效、正文历史留存控制待解决。
生产：12篇当前公开文章均在六专栏，无policy文章需本次回填；既有05/12/16调度及Codex模型未改。
未完成：正式AGY工具/历史隔离；固定候选审查、PR/CI及发布后核验。
下一动作：固定候选并完成发布检查；未解决AGY前不得宣称模型已切换，不自动扩大生产或费用范围。
