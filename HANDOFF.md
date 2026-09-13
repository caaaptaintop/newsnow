# Issue #91：ESLint React 兼容性（本地候选）
目标：恢复正常 ESLint 与提交检查，保留规则力度、PDF官方入口及附件下载行为。
阶段：实现和定向验证完成，待正常本地提交固定候选。
基线：main e45490a2eddf9d8e80a99b2959187efc81decec9。
已完成：6个v2规则名称映射；接入现有app tsconfig满足类型感知规则。
已完成：9项配置回归与36项附件回归；实际pre-commit违规TSX拒绝、合法TSX放行。
未完成：未推送、未合并、未部署；本任务未要求生产操作。
验证入口：test/eslint-config.test.ts；本地.local/eslint-91/RESULT.md。
风险：全库lint仍有6346错误/16警告但无fatal；全库typecheck仍失败，不属全库清零。
审查：普通可逆开发配置修复，按已授权Issue85候选规则自审；未降规则或豁免hook。
归属：当前开发任务独占Issue91分支；产品源码与依赖锁文件未改。
下一动作：正常提交固定候选后交付；远端同步按明确同步点推进。
