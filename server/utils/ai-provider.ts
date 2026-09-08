import { healthTopic } from "@shared/topics"

/** Server configuration only. Never take a provider URL or key from a request. */
export function configuredAI(event: any) {
  const env = event?.context?.cloudflare?.env ?? event?.context?.env ?? {}
  if (env.INTELLIGENCE_AI_PROVIDER !== "proma") {
    const binding = env.AI
    return { provider: "cloudflare", model: healthTopic.aiModel, enabled: !!binding?.run,
      run: binding?.run ? (model: string, params: any) => binding.run(model, params) : undefined }
  }
  const model = String(env.PROMA_MODEL ?? "glm-5.3-flash").trim()
  const key = String(env.PROMA_API_KEY ?? "").trim()
  const protocol = env.PROMA_API_PROTOCOL ?? "chat-completions"
  let endpoint: URL | undefined
  try {
    const base = new URL(String(env.PROMA_BASE_URL ?? "https://api.proma.cool/v1"))
    if (base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash
      && ["responses", "chat-completions", "messages"].includes(protocol)) {
      base.pathname = `${base.pathname.replace(/\/$/, "")}/${protocol === "chat-completions" ? "chat/completions" : protocol}`
      endpoint = base
    }
  } catch { /* Invalid configuration remains unavailable, without exposing values. */ }
  const isGLM53 = /^glm-5\.3(?:-flash)?$/i.test(model)
  const enabled = !!(endpoint && key && model)
  return {
    provider: "proma", model, enabled,
    models: enabled ? async () => {
      const url = new URL(String(env.PROMA_BASE_URL ?? "https://api.proma.cool/v1").replace(/\/$/, "") + "/models")
      let response: Response
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000), redirect: "manual" })
      } catch { throw new Error("Proma 模型列表连接失败") }
      if (!response.ok) throw new Error(`Proma 模型列表请求失败（HTTP ${response.status}）`)
      const result: any = await response.json().catch(() => null)
      if (!Array.isArray(result?.data)) throw new Error("Proma 模型列表格式无效")
      return result.data.flatMap((item: any) => typeof item?.id === "string" ? [item.id] : []) as string[]
    } : undefined,
    run: enabled ? async (_model: string, params: any) => {
      const body = protocol === "responses"
        ? { model, input: params.messages, reasoning: { effort: "low" }, max_output_tokens: params.max_completion_tokens, stream: false, store: false }
        : protocol === "messages"
          ? { model, system: params.messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n"), messages: params.messages.filter((m: any) => m.role !== "system"), max_tokens: params.max_completion_tokens, stream: false, temperature: 0 }
          : { model, messages: params.messages, max_tokens: params.max_completion_tokens, stream: false, temperature: 0, ...(isGLM53 ? { reasoning_effort: "low" } : {}) }
      let response: Response
      try {
        response = await fetch(endpoint!, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...(protocol === "messages" ? { "anthropic-version": "2023-06-01" } : {}) },
          body: JSON.stringify(body), signal: AbortSignal.timeout(isGLM53 ? 90000 : 25000), redirect: "manual",
        })
      } catch { throw new Error("Proma 请求超时或连接失败，本批未完成") }
      // Do not expose provider response bodies: they may echo input or credentials.
      if (!response.ok) {
        const trace = response.headers.get("x-proma-trace-id") ?? ""
        const reference = /^[a-z0-9_-]{1,128}$/i.test(trace) ? `，追踪号 ${trace}` : ""
        throw new Error(`Proma 请求失败（HTTP ${response.status}）${reference}，本批未完成`)
      }
      let result: any
      try { result = await response.json() } catch { throw new Error("Proma 未返回有效 JSON 响应") }
      if (protocol === "messages") {
        if (result.stop_reason !== "end_turn" || !Array.isArray(result.content)) throw new Error("Proma 响应未完成，本批未入库")
        const content = result.content.filter((item: any) => item.type === "text" && typeof item.text === "string").map((item: any) => item.text).join("")
        if (!content) throw new Error("Proma 未返回分析文本")
        return { choices: [{ message: { content } }], usage: result.usage }
      }
      if (protocol === "chat-completions") {
        if (result.choices?.[0]?.finish_reason !== "stop" || typeof result.choices?.[0]?.message?.content !== "string") {
          throw new Error("Proma 响应未完成，本批未入库")
        }
        return result
      }
      if (result.status !== "completed") throw new Error("Proma 响应未完成，本批未入库")
      const content = (result.output ?? []).filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === "output_text")
        .map((item: any) => item.text).join("")
      if (!content) throw new Error("Proma 未返回分析文本")
      return { choices: [{ message: { content } }], usage: result.usage }
    } : undefined,
  }
}
