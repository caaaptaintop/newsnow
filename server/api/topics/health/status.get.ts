import { configuredAI } from "../../../utils/ai-provider"

export default defineEventHandler(async (event) => {
  const ai = configuredAI(event)
  const env = event?.context?.cloudflare?.env || (event?.context as any)?.env
  setHeader(event, "Cache-Control", "no-store")
  let availableModels: string[] | undefined
  let catalogError: string | undefined
  if (getQuery(event).models === "true" && ai.models) {
    try { availableModels = await ai.models() } catch (error) {
      catalogError = error instanceof Error ? error.message : "Proma 模型列表不可用"
    }
  }
  return {
    availableModels,
    catalogError,
    enabled: ai.enabled,
    binding: !!env?.AI?.run,
    provider: ai.provider,
    model: ai.model,
    probe: "configuration-only",
    error: ai.enabled ? undefined : "AI provider configuration is not available",
  }
})
