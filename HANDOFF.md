# Issue111 公开来源审批修复
- 目标：删除未确认来源72篇，公开读取受已确认来源栏目约束。
- 用户已授权删除与同范围发布，并明确本次不做独立审查。
- 生产D1已精确删除72，revision46,total34；住建部34篇hash不变。
- 删除后正常worker complete，公开仍34，失败0，自有锁释放。
- 当前分支codex/public-approved-sources，基线6ab1cb0。
- 本地实现列表/统计/版本/分页/附件审批门，内部去重与配置保留。
- 64相关测试与构建通过；AGY连续错误后主模型接手必要修正。
- 证据.local/public-approval/deletion-verified.json和after-delete-worker.log。
- 下一步：正常提交、CI、合并部署与公开验证。
