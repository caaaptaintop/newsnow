# 全库发布时间核验（当前有效）

2026-09-09 对四个主题全部631条记录逐条处理，517条有来源依据（其中143条为X帖子ID编码创建时间），114条未知；线上四主题619条去重结果全部包含在本次范围，没有额外遗漏记录。

完整逐条记录见 [publication-date-audit.csv](publication-date-audit.csv)。未知包含非单篇内容、未读取到明确发布时间、原网页不可访问；不沿用旧日期。此处“全库处理完成”不表示全部631条都已查到准确时间。

后续新内容在入库前核验发布时间，保存来源依据、核验时间及未知原因。优先原文发布元数据、对应文章的源站结构化数据；X帖子使用官方Snowflake编码创建时间（BigInt保留精度并拒绝未来/非法ID），官方独立列表日期仅作可验证兜底；不使用修改时间、采集时间、标题中会议日期、热榜更新时间。保留源站提供的时区和时分秒，只有日期则保留日期精度。

每次部署同步现有D1记录的日期字段及核验依据，并在 intelligence_publication_backup_v1 保存首次更新前的日期，其他元数据不变。页面和最新发布排序仅使用有依据的发布时间，未知记录排后。

复核工具 tools/ai-bridge/audit-publication-dates.ts 默认只生成本机审计；传 --apply 才更新仓库快照。源码不保存正文或附件；核验仅读取公开元数据，不调用模型。

X 编码依据：[官方ID文档](https://docs.x.com/fundamentals/x-ids)、[官方Snowflake实现](https://github.com/twitter-archive/snowflake/blob/snowflake-2010/src/main/scala/com/twitter/service/snowflake/IdWorker.scala)。编码时间不等于已验证帖子正文可访问。
