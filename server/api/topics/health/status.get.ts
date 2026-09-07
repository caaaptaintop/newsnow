import { healthTopic } from "@shared/topics"

export default defineEventHandler(async (event) => {
  const ai = event?.context?.cloudflare?.env?.AI
    || (event?.context as any)?.env?.AI

  if (!ai?.run) {
    return {
      enabled: false,
      binding: false,
      model: healthTopic.aiModel,
      error: "Workers AI binding is not available",
    }
  }

  try {
    const result: any = await ai.run(healthTopic.aiModel, {
      messages: [
        { role: "user", content: "只回复 OK" },
      ],
      max_completion_tokens: 16,
      stream: false,
    })

    const text = result?.choices?.[0]?.message?.content
      ?? result?.response
      ?? ""

    return {
      enabled: true,
      binding: true,
      model: healthTopic.aiModel,
      response: String(text).slice(0, 40),
    }
  } catch (error) {
    return {
      enabled: false,
      binding: true,
      model: healthTopic.aiModel,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})
