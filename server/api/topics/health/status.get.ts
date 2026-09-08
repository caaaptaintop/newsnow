import { configuredAI } from "../../../utils/ai-provider"

export default defineEventHandler(async (event) => {
  const ai = configuredAI(event)
  const env = event?.context?.cloudflare?.env || (event?.context as any)?.env
  setHeader(event, "Cache-Control", "no-store")
  return {
    enabled: ai.enabled,
    binding: !!env?.AI?.run,
    provider: ai.provider,
    model: ai.model,
    probe: "configuration-only",
    error: ai.enabled ? undefined : "AI provider configuration is not available",
  }
})
