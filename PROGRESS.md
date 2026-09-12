# 阶段进度

本文件只记录阶段级状态，不作为长期规则真源，也不累计每个本地小 commit。长期工程规则见 `AGENTS.md`，当前接续现场见 `HANDOFF.md`。

## 开发流程治理修正（2026-09-12）

当前治理 Issue：#79。目标是把 `newsnow` 的 local-first 协作修正为与 AI Cube 当前流程一致：默认开发现场为本地 Codex 工作区，通过 `codex-chatgpt-web` / MCP 让 ChatGPT Web 模型进入同一明确 worktree，Web 负责需求/架构/实现与编辑决策、测试设计、本地 diff 审查和阶段判断，Codex 工具层负责文件、Git、Shell、测试、构建、GUI/macOS 和本机事实执行。

#77 / #78 只保留为此前治理迁移与审查的历史依据，不作为 #79 的活动 Issue/PR，也不延续其中“Codex 只能处理 Mac 独占事项”的旧职责限制或旧未完成状态。#79 当前尚未创建新的 Draft PR；待本地 clean candidate 固定后再进入正式同步与独立审查。

当前长期目标：

- Canonical repository identity 固定为 `caaaptaintop/newsnow`；本地开发先通过 Repository Identity Gate，并绑定任务明确指定的 worktree；
- 正式链路为 `Issue → 独立 branch/worktree → 本地 Codex 工作区 → Web 模型进入同一 worktree → 本地连续开发/验证 → fixed candidate → Draft PR → fresh independent review → final Head → main → deployment/acceptance`；
- Issue/branch/worktree/checkpoint/push/Draft PR/普通 fresh review 默认自动编排，普通 review 由桥接创建并回收 fresh Web context，用户不承担常规上下文搬运；
- 桥接不可用、不能确认进入同一 worktree或不能保证真正 fresh review context 时明确阻断，不把网页端 GitHub 直改作为默认降级路径；
- 原生 Codex 模型只按需承担边界清晰的本机专项，不为形式上的独立重复整套开发、修改和审查推理；
- local-first 只调整执行位置和同步频率，不降低单元/回归、改动文件 lint/类型、必要构建、发布安全、页面浏览器交互、恢复/幂等故障路径等适用验证门槛；
- Repository Identity Gate 的 HTTPS userinfo hardening、PR #76 的 JPaas/runtime-source-test 发布门禁，以及 building-only、Cloudflare Access、D1、附件无持久化、Mac worker/launchd/900 秒调度等产品和生产保护边界全部保持；
- 高风险生产、数据、鉴权、调度、迁移、发布门禁、CI/部署门槛和治理/review 路由变化继续固定 Head，完成更高等级独立 Web 审查后才允许合并。

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
