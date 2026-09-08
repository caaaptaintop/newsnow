import { healthTopic } from "@shared/topics"

export default defineEventHandler(async (event) => {
  const ai = event?.context?.cloudflare?.env?.AI
    || (event?.context as any)?.env?.AI

  const binding = !!ai?.run
  return {
    enabled: binding,
    binding,
    model: healthTopic.aiModel,
    probe: "binding-only",
    note: binding ? "Workers AI binding is available; inference quota is checked by actual classification calls." : undefined,
    error: binding ? undefined : "Workers AI binding is not available",
  }
})
