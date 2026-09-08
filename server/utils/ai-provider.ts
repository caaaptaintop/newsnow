import { healthTopic } from "@shared/topics"

/** Server configuration only. Never take a provider URL or key from a request. */
export function configuredAI(event: any) {
  const env = event?.context?.cloudflare?.env ?? event?.context?.env ?? {}
  if (env.INTELLIGENCE_AI_PROVIDER !== "proma") {
    const binding = env.AI
    return { provider: "cloudflare", model: healthTopic.aiModel, enabled: !!binding?.run,
      run: binding?.run ? (model: string, params: any) => binding.run(model, params) : undefined }
  }
  const model = String(env.PROMA_MODEL ?? "gpt-5.6-luna").trim()
  const key = String(env.PROMA_API_KEY ?? "").trim()
  let endpoint: URL | undefined
  try {
    const base = new URL(String(env.PROMA_BASE_URL ?? "https://api.proma.cool/v1"))
    if (base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash) {
      base.pathname = `${base.pathname.replace(/\/$/, "")}/responses`
      endpoint = base
    }
  } catch { /* Invalid configuration remains unavailable, without exposing values. */ }
  const enabled = !!(endpoint && key && model)
  return {
    provider: "proma", model, enabled,
    run: enabled ? async (_model: string, params: any) => {
      const body = { model, input: params.messages, reasoning: { effort: "low" },
        max_output_tokens: params.max_completion_tokens, stream: false, store: false }
      let response: Response
      try {
        response = await fetch(endpoint!, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(25000), redirect: "error",
        })
      } catch { throw new Error("Proma 请求超时或连接失败，本批未完成") }
      // Do not expose provider response bodies: they may echo input or credentials.
      if (!response.ok) throw new Error(`Proma 请求失败（HTTP ${response.status}），本批未完成`)
      let result: any
      try { result = await response.json() } catch { throw new Error("Proma 未返回有效 JSON 响应") }
      if (result.status !== "completed") throw new Error("Proma 响应未完成，本批未入库")
      const content = (result.output ?? []).filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === "output_text")
        .map((item: any) => item.text).join("")
      if (!content) throw new Error("Proma 未返回分析文本")
      return { choices: [{ message: { content } }], usage: result.usage }
    } : undefined,
  }
}
