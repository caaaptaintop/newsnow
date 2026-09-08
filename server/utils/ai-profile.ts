import type { AIProfile } from "../../shared/ai-settings"

const hosts = ["api.openai.com", "api.x.ai", "api.proma.cool", "api.deepseek.com", "api.anthropic.com", "open.bigmodel.cn", "api.z.ai", "generativelanguage.googleapis.com"]
export function normalizeProfile(raw: any, allowedHosts = ""): AIProfile {
  const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : ""
  const id = text(raw?.id, 64), name = text(raw?.name, 80), model = text(raw?.model, 160)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !name || !model || /[\r\n]/.test(model)) throw new Error("配置编号、名称和模型 ID 必须有效")
  if (!["api", "codex", "grok-subscription", "cloudflare"].includes(raw.kind)) throw new Error("接入类型无效")
  if (!["chat-completions", "responses", "messages"].includes(raw.protocol)) throw new Error("接口协议无效")
  if (!["bearer", "x-api-key"].includes(raw.authHeader) || !["", "low", "medium", "high"].includes(raw.reasoning)) throw new Error("认证或推理参数无效")
  const timeoutSeconds = Number(raw.timeoutSeconds)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 75) throw new Error("超时须为 10—75 秒的整数")
  let baseUrl = ""
  if (raw.kind !== "cloudflare") {
    let url: URL
    try { url = new URL(String(raw.baseUrl)) } catch { throw new Error("请填写完整的 HTTPS 接口根地址") }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")
      || url.href.length > 500 || !/^[a-z0-9.-]+$/i.test(url.hostname) || /^\d+(\.\d+)*$/.test(url.hostname)
      || /(^|\.)(localhost|local|internal|invalid|test)$/.test(url.hostname)) throw new Error("接口地址须为公网 HTTPS 域名，不能含凭据、参数或非标准端口")
    const allowed = new Set([...hosts, ...allowedHosts.split(",").map(h => h.trim().toLowerCase()).filter(Boolean)])
    if (!allowed.has(url.hostname.toLowerCase())) throw new Error("此域名未获授权；请先将其加入服务端 AI_ALLOWED_HOSTS（逗号分隔的精确域名）")
    if (/\/(chat\/completions|responses|messages|models)\/?$/.test(url.pathname)) throw new Error("请填写接口根地址（通常以 /v1 结尾），不要填写具体调用路径")
    baseUrl = url.href.replace(/\/$/, "")
  }
  if ((raw.kind === "codex" || raw.kind === "grok-subscription") && raw.protocol !== "chat-completions") throw new Error("订阅执行节点使用 Chat Completions 协议")
  return { id, name, kind: raw.kind, model, baseUrl, protocol: raw.protocol, authHeader: raw.authHeader, reasoning: raw.reasoning, timeoutSeconds }
}
export function createProfileAI(profile: AIProfile, key: string, env: any = {}) {
  if (profile.kind === "cloudflare") {
    const binding = env.AI
    return { provider: "cloudflare", model: profile.model, enabled: !!binding?.run,
      run: binding?.run ? (_: string, params: any) => binding.run(profile.model, params) : undefined,
      models: undefined }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  headers[profile.authHeader === "x-api-key" ? "x-api-key" : "Authorization"] = profile.authHeader === "x-api-key" ? key : `Bearer ${key}`
  if (profile.protocol === "messages") headers["anthropic-version"] = "2023-06-01"
  const call = async (path: string, body?: unknown) => {
    let response: Response
    try {
      response = await fetch(`${profile.baseUrl}/${path}`, { method: body === undefined ? "GET" : "POST", headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual",
        signal: AbortSignal.timeout(body === undefined ? 10000 : profile.timeoutSeconds * 1000) })
    } catch { throw new Error("AI 请求超时或连接失败；未自动重试或切换提供方") }
    if (!response.ok) throw new Error(`AI 请求失败（HTTP ${response.status}）；未自动重试或切换提供方`)
    // Never forward upstream error bodies, headers, or echoed credentials.
    try { return await response.json() as any } catch { throw new Error("AI 接口未返回有效 JSON") }
  }
  return { provider: `${profile.kind}:${profile.id}`, model: profile.model, enabled: !!key,
    models: key ? async () => {
      const result = await call("models")
      if (!Array.isArray(result?.data)) throw new Error("模型列表格式无效；可手工填写模型 ID")
      return result.data.flatMap((m: any) => typeof m?.id === "string" && m.id.length <= 160 ? [m.id] : []).slice(0, 300) as string[]
    } : undefined,
    run: key ? async (_: string, params: any) => {
      const messages = params.messages
      const max = Math.max(64, Math.min(8192, Number(params.max_completion_tokens) || 3000))
      const body = profile.protocol === "responses"
        ? { model: profile.model, input: messages, max_output_tokens: max, stream: false, store: false,
            ...(profile.reasoning ? { reasoning: { effort: profile.reasoning } } : {}) }
        : profile.protocol === "messages"
          ? { model: profile.model, system: messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n"),
              messages: messages.filter((m: any) => m.role !== "system"), max_tokens: max, temperature: 0, stream: false }
          : { model: profile.model, messages, max_tokens: max, stream: false,
              ...(profile.reasoning ? { reasoning_effort: profile.reasoning } : {}) }
      const result = await call(profile.protocol === "chat-completions" ? "chat/completions" : profile.protocol, body)
      let content: string | undefined
      if (profile.protocol === "responses") {
        if (result?.status !== "completed" || !Array.isArray(result.output)) throw new Error("AI 响应未完成，本批未入库")
        content = result.output.filter((m: any) => m?.type === "message" && m.status !== "incomplete")
          .flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((m: any) => m?.type === "output_text" && typeof m.text === "string").map((m: any) => m.text).join("")
      } else if (profile.protocol === "messages") {
        if (result?.stop_reason !== "end_turn" || !Array.isArray(result.content)) throw new Error("AI 响应未完成，本批未入库")
        content = result.content.filter((m: any) => m?.type === "text" && typeof m.text === "string").map((m: any) => m.text).join("")
      } else {
        if (result?.choices?.[0]?.finish_reason !== "stop") throw new Error("AI 响应未完成，本批未入库")
        content = result.choices[0]?.message?.content
      }
      if (typeof content !== "string" || !content.trim()) throw new Error("AI 未返回分析文本")
      return { choices: [{ finish_reason: "stop", message: { content } }], usage: result.usage }
    } : undefined }
}
