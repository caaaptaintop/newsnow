# Issue #94：接入建筑正文分析并准备现有文章重分析

目标：Mac 建筑分析改为先提取详情正文再交给现有 AI；提取失败明确降级标题。先少量真实文章确认摘要依据，再生成现有 12 篇精确重分析候选。生产回填走高级独立审查，本任务不发送、不 merge、不 deploy。

阶段：本地实现与定向测试已完成，待本地提交后做实网质检、merge main、Draft PR。
基线：`9c648b1beda982204b5ee0dbd3d95ca8b85dfe39`（Issue #93 已作为 origin/main `e13cfab5370b25edf69337a9bbce4aa8e6fbb83d` 上线）。
分支：`codex/building-body-analysis-94`
工作区：`/Users/imac/Projects/newsnow-issue-94`
执行：Grok CLI 独占正文实现；不是唯一写者，不改其他工作区。

已完成：分类前受限详情提取、内存正文、截断标注、标题降级警告、PENDING 仅白名单决策（验证失败不保存原始响应）、同次解析元数据复用、body 证据可合并、回填基线同版本同集合校验、重分析候选工具默认不发送。
定向测试：`test/mac-batch.test.ts` 20 项通过；改动文件 eslint 0 error；改动文件 tsc 无新增错误。
未完成：clean commit、少量实网质检、12 篇候选、普通 merge origin/main、Draft PR、`.local/body-94/result.md`。不得执行生产回填。

风险：生产回填属真实生产写入，触发候选 AGENTS 2.6 高级独立审查；keep=false 不得删除旧文。
审查：实现为普通产品改动；生产数据操作另任务启动高级审查，不能以开发自审或自行委派代替。
下一动作：正常 hook 本地提交。
