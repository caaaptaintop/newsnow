# 当前阶段：Issue #94 正文分析接入（待本地提交）

已核验 canonical 仓库与工作区 `/Users/imac/Projects/newsnow-issue-94`，branch `codex/building-body-analysis-94`。按入口登记的 Issue #85 候选 AGENTS 覆盖旧 main 冲突规则。

Mac 批次在 AI 前用既有受限解析器提取详情正文；正文只在内存传给现有分类器，限 1200 字并标注截断。提取成功才标 `evidence=body`，失败或不足仍为 `title`，并用已有来源警告标明原因。同一次解析复用 publisher/documentNo/attachments。PENDING 只在分类验证通过后写入白名单决策与列表元数据，不保存原始 AI 响应。建筑单栏目、`tags=[]` 保持。PDF/附件原站链接和日期验证未改。

重分析锁定公开元数据时核验独立 version 与 feed 同版本、无截断/下一页、无重复 key、篇数一致；确认时比较含附件/`otherSources` 的身份字段。公开接口隐藏的 model/analysisVersion 旧值记为 `unknown`。生成候选后再次读取，漂移则拒绝可回填计划。keep=false 标待审并停止对应回填，不删除。默认不发送。生产写入未执行。
