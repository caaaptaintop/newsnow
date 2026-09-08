# Proma Cloud 模型接入

状态：PENDING，按用户最新要求切换 GLM 5.3 Flash，待真实调用验收。

依据：2026-09-08 用户提供的 Proma 控制台 API 说明截图。GPT-5.6 系列必须调用 `https://api.proma.cool/v1/responses`，请求字段为 `input`。

## 生产配置

在 Cloudflare Pages `capx-newsnow` 的 Production 中设置：

| 变量 | 值 | 类型 |
| --- | --- | --- |
| PROMA_API_KEY | 在 Proma 为情报站创建的独立密钥 | Secret |
| INTELLIGENCE_AI_PROVIDER | proma | 普通变量，验收时再开启 |
| PROMA_MODEL | glm-5.3-flash | 普通变量，可省略，代码默认此值 |
| PROMA_API_PROTOCOL | chat-completions | 普通变量，可省略，代码默认此值 |
| PROMA_BASE_URL | https://api.proma.cool/v1 | 普通变量，可省略，代码默认此值 |

先在 Proma 为密钥设置额度上限。密钥不进入 Git、浏览器或日志。保存变量后重新部署才生效。

## 行为

- 所有情报主题和健宁分类共用服务端模型配置，GLM 使用 Chat Completions 和 temperature=0；Responses 保留给 GPT 系列，GLM 5.3 系列显式设置 reasoning_effort=low，单次调用超时 60 秒；其他模型 25 秒。
- 返回未完成、限流或无效 JSON 时保留错误并等待后续重试；付费调用不立即重复请求，不把失败结果入库。
- Proma 启用但配置不全时报告不可用，不静默换模型。将 provider 改回 `cloudflare` 并重新部署可恢复原模型。
- D1 已有或快照已有的同 URL、同标题文章不因换模型重新分析。仅标题变化能够在当前去重机制中触发重新分析；正文单独变化尚无检测机制。
- 新记录标注实际配置模型；旧记录保留原模型。健宁浏览器缓存按服务端模型区分。
- 不保存正文、HTML，不下载附件，不启用 R2。Responses 请求设置 `store:false`；这不替代供应商自己的日志/数据保留政策。

## 验收

1. 单元测试覆盖 Responses 输入输出、完整响应、配置缺失、错误隐藏及不重复付费调用。
2. `/api/topics/health/status` 显示 `provider=proma`、`model=glm-5.3-flash`、`enabled=true` 只表示配置完整。
3. 仍需真实分类请求验证接口、JSON、耗时和返回模型；查看 Proma 用量核实实际扣费，不按宣传折扣猜算费用。
4. 存储状态必须继续为 D1 v2 可用且 R2 关闭。

部署沿用现有 GitHub Actions。尚未完成真实 30 条情报质量对比。GLM 参数依据：https://docs.z.ai/api-reference/llm/chat-completion（5.3 系列推理不可关闭，默认 max，分类采用 low）。
