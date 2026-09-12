# 阶段进度

本文件只记录阶段级状态，不作为长期规则真源，也不累计每个本地小 commit。长期工程规则见 `AGENTS.md`，当前接续现场见 `HANDOFF.md`。

## 开发流程治理修正（2026-09-12）

当前治理 Issue：#79，Draft PR：#80。用户最新确认的目标是：从固定 Codex 项目入口只提需求、看结果和给修改意见，由当前选定模型自动定位、复用或创建 Issue、分支和 worktree，处理提交、PR 和进度。用户可选择原生或网页开发模型，不必手动选择分支、切 worktree 或搬运内容。此前本轮特定 Web 执行要求不再推广为全部开发的固定职责限制。

当前阶段：newsnow 单项目试行与固定候选审查。2026-09-12 15:37 Asia/Shanghai 快照：上一候选已完成桥接恢复与审查，但强制 Web 开发及入口自动定位不足，正按用户反馈修正。同一 Issue/branch/PR 继续，不重开任务，不合并。当前完整候选、同步、CI 和 review 以 PR #80 的 `headRefOid`、绑定 SHA 的报告及本地 HEAD 实时核对；新 Head 不沿用旧审查和 CI 结论。

本阶段范围：

- 五个真实场景已冻结在 `docs/AI-COLLABORATION.md`，只在本项目试行，用户确认体验后才能定版；不迁移其他项目。
- 入口先核验身份，再自动定位任务；模型明确绑定目标后再次运行原 Identity Gate。入口文件保留，不因新对话或切模型重复开 Issue/分支。
- 本机固定入口指引和任务路径写入入口现有 `AGENTS.md` / `.local/CONTEXT.md`，精确备份并保留历史正文；该本机适配独立于仓库候选，不声称 main 已采用。
- 当前模型负责完整开发；桥接只约束需要 Web 的动作；普通及高风险 fresh Web review 保留，无法审查就暂停合并。
- 最低测试矩阵、Identity Gate 脚本及全部产品/生产边界不变；不改业务代码、workflow、预算或全局配置。
- 验证区分真实入口发现/只读探针与场景推演；不把推演说成新任务创建或真实并发实测，也不承诺 Codex 界面自动切换。

## 迁移前产品工作状态

Issue #74 / PR #76 的住建部动态列表、JPaas 分页和 Mac runtime source-test fallback 已完成代码复审、合并和生产发布。已上线安全边界包括：

- JPaas 同源 HTTPS 确定性读取；第 2 页起使用 `paramJson={"pageNo":N,"pageSize":20}`；生产采集有停止条件和单栏目单轮 5 页硬上限；
- Cloudflare 云端只因 DNS/网络失败时可排队等待签名 Mac 自然周期复核，发布门禁不降低；
- runtime source-test 使用独立 `runtime-source-test` capability，短期 deployment bearer 不具备该能力；
- Cloudflare 对住建部的 530/1016 网络环境现象本身仍作为已知边界，不把 fallback 上线写成 DNS 根因消失。

Issue #74 是否关闭应按其剩余目标单独判断；#79 的治理修正不重写其历史事实，也不复用 #77/#78 的旧未完成状态。

## 当前产品基线

- 公开仅启用 `building` 建筑主题，免登录；
- 内部信息源管理中心受 Cloudflare Access 和应用层管理员校验保护；
- 正常阅读、搜索、翻页、刷新、附件预览不调用 AI；
- 持久层只保存结构化元数据、摘要、分类和原站链接，不长期保存正文/完整 HTML/附件字节；
- 继续使用既有 D1 与迁移结果；
- Mac 后台继续沿用现有 launchd 和自然 900 秒周期，不新增第二调度器；
- 未经用户明确同意不新增收费 API/代理/模型费用。

## 后续阶段记录原则

阶段变化时更新这里；具体 branch、candidate Head、worktree 是否适用/clean/dirty、验证结果和下一同步点写入 `HANDOFF.md`。临时 SHA、单次 CI 数字和一次性生产 revision 不进入长期规则 `AGENTS.md`。
