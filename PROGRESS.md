# 阶段进度

本文件只记录阶段级状态，不作为长期规则真源，也不累计每个本地小 commit。长期工程规则见 `AGENTS.md`，当前接续现场见 `HANDOFF.md`。

## 开发流程治理（2026-09-12）

项目正在迁移为与 AI Cube 同款的 local-first 开发治理：产品架构和既有安全边界不变，GitHub Issue / Draft PR / main 正式治理不变；连续开发、测试和中间修改默认在明确本地 worktree 与独立 branch 完成，达到 clean fixed candidate 后再同步 GitHub。GitHub Actions 不再作为每个中间改动的必要前置，而用于 fixed candidate 的共享验证。

当前治理 Issue：#77 `开发流程迁移：local-first + AI Cube 同款自动编排`。当前 Draft PR：#78。

迁移目标：

- Canonical repository identity 固定为 `caaaptaintop/newsnow`，本地会话先通过 Repository Identity Gate；
- 正式链路为 `Issue → branch/worktree → local develop/test → fixed candidate → Draft PR → independent review → final Head → main → deployment/acceptance`；
- Issue/branch/worktree/checkpoint/push/Draft PR/普通 review 默认自动编排，用户不承担常规项目管理；
- 网页端未接入本地 worktree 时，不把未 push 事实冒充为已读取；
- 保留 ChatGPT 技术负责人、Codex 本地工具层的分工；
- 保留 building-only 公开基线、Cloudflare Access、D1、来源管理、附件无持久化、Mac worker/launchd/900 秒调度等全部产品和生产保护边界；
- 高风险生产、数据、鉴权、调度、迁移、发布门禁和不可逆操作继续要求更高等级独立审查。

## 迁移前产品工作状态

Issue #74 / PR #76 的住建部动态列表、JPaas 分页和 Mac runtime source-test fallback 已完成代码复审、合并和生产发布。已上线安全边界包括：

- JPaas 同源 HTTPS 确定性读取；第 2 页起使用 `paramJson={"pageNo":N,"pageSize":20}`；生产采集有停止条件和单栏目单轮 5 页硬上限；
- Cloudflare 云端只因 DNS/网络失败时可排队等待签名 Mac 自然周期复核，发布门禁不降低；
- runtime source-test 使用独立 `runtime-source-test` capability，短期 deployment bearer 不具备该能力；
- Cloudflare 对住建部的 530/1016 网络环境现象本身仍作为已知边界，不把 fallback 上线写成 DNS 根因消失。

Issue #74 是否关闭应按其剩余目标单独判断；流程迁移不重写其历史事实。新的开发任务在 #77/#78 合并后默认使用 local-first 流程。

## 当前产品基线

- 公开仅启用 `building` 建筑主题，免登录；
- 内部信息源管理中心受 Cloudflare Access 和应用层管理员校验保护；
- 正常阅读、搜索、翻页、刷新、附件预览不调用 AI；
- 持久层只保存结构化元数据、摘要、分类和原站链接，不长期保存正文/完整 HTML/附件字节；
- 继续使用既有 D1 与迁移结果；
- Mac 后台继续沿用现有 launchd 和自然 900 秒周期，不新增第二调度器；
- 未经用户明确同意不新增收费 API/代理/模型费用。

## 后续阶段记录原则

阶段变化时更新这里；具体 branch、candidate Head、worktree clean/dirty、本地测试和下一同步点写入 `HANDOFF.md`。临时 SHA、单次 CI 数字和一次性生产 revision 不进入长期规则 `AGENTS.md`。
