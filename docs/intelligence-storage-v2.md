# 情报存储 v2：只调整结构，不启用正文和附件归档

## 本次边界

已实现元数据关系表、v1 兼容迁移和运行状态接口。本次不创建、不绑定、不启用 R2；不保存正文、原始 HTML 或附件文件，不增加全文检索、附件解析或下载任务。原有采集器仍可为了当次 AI 分类临时读取网页正文，处理完不归档。`evidence: body` 表示分类时使用过正文，不表示正文已保存。

`shared/intelligence-storage.ts` 固定策略为：`saveBody=false`、`saveHtml=false`、`downloadAttachments=false`、`r2Enabled=false`。入库采用元数据字段白名单，即使调用者额外带入 `body`、`rawHtml`、附件字节等字段也不保存。标签、标题、AI 摘要、原始链接仍正常保存。

## 当前运行方式与实际启用状态

部署工作流 `.github/workflows/cloudflare-pages.yml` 当前以仓库 JSON 快照作为持久数据来源，保留有效的已有 `NEWSNOW_DB` 绑定但不自动创建 D1。**代码支持 D1 不等于线上已经启用了 D1。** 原有 `/api/intelligence` 的 `persistent` 字段包含仓库快照可用的含义，不能用它证明数据库写入成功。

新增 `GET /api/intelligence/storage` 区分：

- `runtimeDatabase.available`：此次运行是否成功取得 SQL 数据库并初始化 v2。
- `durableStorage`：`database_and_snapshot` / `database` / `repository_snapshot` / `none`。
- `repositorySnapshot`：快照是否存在、生成时间和记录数。
- `migration`：结构是否已应用、剩余可迁移旧记录数及无效 JSON 行数。
- `policy`：上述四项关闭策略及 `attachmentMode: links_only`。

该接口不触发信息采集或 AI 调用。数据库未绑定或初始化失败时返回清晰状态，现有快照信息仍然可用。它不会自动把快照全部导入数据库。本次不变更 Cloudflare 资源和计费设置。

## 结构

| 表 | 用途 |
| --- | --- |
| `intelligence_sources_v2` | 已入库记录所对应来源的名称、分组、级别和地区；完整来源注册表仍为 `shared/official-sources.ts` |
| `intelligence_documents_v2` | 标题、链接、主题、来源、发布机构、文号、发布日期、首次/最近采集时间、当前分析版本 |
| `intelligence_analyses_v2` | 按文章、模型、分析版本分开保存摘要、分类、标签、类型、重要度、判断依据 |
| `intelligence_document_categories_v2` | 当前主栏目和关联栏目关系及查询索引 |
| `intelligence_document_tags_v2` | 当前文章标签关系及查询索引 |
| `intelligence_attachments_v2` | 附件名称、原链接及未来存储位置的空字段 |
| `intelligence_content_refs_v2` | 正文文本/HTML 两种表示的未来位置空字段，不包含正文内容 |
| `intelligence_schema_migrations` | 已应用的结构版本 |

`intelligence_documents_v1` 暂留作兼容写入层和旧版回滚读取层；`intelligence_state_v1` 保留现有采集状态、去重缓存格式。本阶段会有 v1 元数据与 v2 关系表的少量重复存储，不是正文或文件重复归档。

一级主题和二级栏目编码沿用既有配置，不改变首页布局、栏目命名、分类规则或搜索范围。地区/来源/栏目/标签/类型已具备关系字段与索引，但现有前端仍在已加载记录内筛选；本次不声称已经实现全部历史记录的服务端搜索。

## 正文和附件的预留方式

正文记录的默认状态是 `not_saved`。附件记录默认 `remote`，只代表存在原始链接。两类记录都预留：

`storage_provider`、`object_key`、`content_hash`、`byte_size`、`archived_at`。

当前均为空，不写入任何文件。标记为 `stored` 必须同时具备存储提供方和对象键，避免仅有 URL 就宣称已经归档。这些字段本身不构成下载器；将来启用归档仍需明确接入对象存储、鉴权、归档任务与容量策略，不能只把一个布尔值改为 true。

## 写入、查询及迁移

SQL 数据库可用时按幂等建表流程应用结构。新文章以单条参数化写入进入兼容层；同一 SQLite 语句内的触发器同步拆分来源、文章、分析和关系表。中间约束失败会撤销该次整条写入，不留下半条情报。更新保留最早采集时间；同模型同分析版本更新现有结果，更换模型或分析版本会保留不同版本，不承诺保存每一次 AI 调用的历史。

读取优先使用 `intelligence_feed_v2`，还没迁移的 v1 记录通过兼容查询继续显示。每次数据库文章读取最多回填 50 条旧记录，可重复执行，不删除 v1 数据。无效 JSON 保留在旧表，不强行转换。若旧数据不满足新约束，该批迁移失败不会隐藏旧记录；剩余数可从状态接口检查，再针对异常记录处理。

数据库不可用时继续使用临时内存及现有 GitHub 快照；临时内存不等于持久数据库。快照仍只保存轻量情报记录，不包含正文或附件文件。保持现有快照容量和采集频率，不趁本次变更增加保存规模。

## 验证及回滚

执行：

```sh
node --experimental-strip-types --test test/intelligence-storage.test.mjs
```

测试使用 Node 22 内置 SQLite，覆盖幂等结构、API 记录往返、字段白名单、空存储引用、缺失发布日期、重复写入、版本结果、分批迁移、损坏旧 JSON、原子回滚、删除清理及预留引用保留。它不创建 Cloudflare 资源，也不访问外部附件。

CI 工作流为 `Intelligence metadata storage checks`。PR 另由现有 `Intelligence workspace checks` 验证项目回归、Cloudflare 构建和变更文件类型诊断。

回滚代码可以继续读取原有 v1 表和快照，不需要删除新表。不得在回滚时清空原始表。无正文归档意味着原站失效后不能保证恢复原文，未来重做全文分析仍需重新获取网页。
