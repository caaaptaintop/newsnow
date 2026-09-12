# 阶段进度

本文件只记录阶段级状态，不作为长期规则真源，也不累计每个本地小 commit。长期工程规则见 `AGENTS.md`，当前接续现场见 `HANDOFF.md`。

## 开发流程治理（2026-09-12）

项目正在迁移为与 AI Cube 同款的 local-first 治理框架：产品架构和既有安全边界不变，GitHub Issue / Draft PR / main 正式治理不变；目标是减少中间 push/Actions、使用 fixed candidate 和 fresh review。local-first 只在 ChatGPT 当前实际具备可信本地桥接/工作区时改变开发执行位置；若没有本地桥接，则继续由 ChatGPT 使用 GitHub/云端工具推进，**不把普通开发转交 Codex 来模拟 local-first**。

当前治理 Issue：#77 `开发流程迁移：local-first + AI Cube 同款自动编排`。当前 Draft PR：#78。

首轮 fresh independent review 已确认流程方向可继续，但提出两个 P1 blocker 和一个 P2 hardening：

- Codex 职责不能从“Mac 独占执行器”扩大为普通文件修改/Git/测试/commit/push 执行层；
- 迁移不能删除当前 canonical `AGENTS.md` 已有的最低测试矩阵；
- Repository Identity Gate 应对 HTTPS userinfo/password 同样 fail-closed。

这些问题在原 #77 / #78 内修复；形成新 fixed Head 后必须重新 fresh independent review，旧 Head 的结论不延续。

迁移后的长期目标：

- Canonical repository identity 固定为 `caaaptaintop/newsnow`，使用本地 worktree 时先通过 Repository Identity Gate；
- 正式链路为 `Issue → branch/worktree（如适用）→ ChatGPT 主导开发/验证 → fixed candidate → Draft PR → independent review → final Head → main → deployment/acceptance`；
- Issue/branch/worktree（如适用）/checkpoint/push/Draft PR/普通 review 默认自动编排，用户不承担常规项目管理；
- 网页端未接入本地 worktree 时，不把未 push 事实冒充为已读取；
- ChatGPT 继续是技术负责人和主要开发者；Codex 仍只处理 ChatGPT/GitHub/CI/线上工具无法充分完成且确实依赖用户 Mac 的事项；
- local-first 只调整执行位置和同步频率，不降低单元/回归、改动文件 lint/类型、必要构建、发布安全、页面浏览器交互、恢复/幂等故障路径等适用验证门槛；
- 保留 building-only 公开基线、Cloudflare Access、D1、来源管理、附件无持久化、Mac worker/launchd/900 秒调度等全部产品和生产保护边界；
- 高风险生产、数据、鉴权、调度、迁移、发布门禁、治理/review 路由和不可逆操作继续要求更高等级独立审查。

## 迁移前产品工作状态

Issue #74 / PR #76 的住建部动态列表、JPaas 分页和 Mac runtime source-test fallback 已完成代码复审、合并和生产发布。已上线安全边界包括：

- JPaas 同源 HTTPS 确定性读取；第 2 页起使用 `paramJson={"pageNo":N,"pageSize":20}`；生产采集有停止条件和单栏目单轮 5 页硬上限；
- Cloudflare 云端只因 DNS/网络失败时可排队等待签名 Mac 自然周期复核，发布门禁不降低；
- runtime source-test 使用独立 `runtime-source-test` capability，短期 deployment bearer 不具备该能力；
- Cloudflare 对住建部的 530/1016 网络环境现象本身仍作为已知边界，不把 fallback 上线写成 DNS 根因消失。

Issue #74 是否关闭应按其剩余目标单独判断；流程迁移不重写其历史事实。新的开发任务在 #77/#78 合并后默认使用新的治理流程。

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
