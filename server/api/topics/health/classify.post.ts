import { healthTopic } from "@shared/topics"

interface CandidateInput {
  key: string
  title: string
  source?: string
  rank?: number
}

interface AIHealthMatch {
  key: string
  score: number
  category: string
}

interface ClassifyResponse {
  enabled: boolean
  model: string
  matches: AIHealthMatch[]
  error?: string
}

const categories = [
  "exercise",
  "weight",
  "nutrition",
  "sleep",
  "metabolic",
  "cardiovascular",
  "preventive",
  "medical_research",
  "public_health",
  "mental_health",
  "other_health",
] as const

function cleanText(value: unknown, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function getAI(event: any) {
  return event?.context?.cloudflare?.env?.AI
    || event?.context?.env?.AI
}

function parseModelPayload(result: any) {
  const raw = result?.choices?.[0]?.message?.content
    ?? result?.response
    ?? result

  if (raw && typeof raw === "object") return raw
  if (typeof raw !== "string") throw new Error("Workers AI returned an unsupported response")

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error("Workers AI did not return valid JSON")
  }
}

export default defineEventHandler(async (event): Promise<ClassifyResponse> => {
  const body = await readBody<{ items?: CandidateInput[] }>(event)
  const items = (body?.items ?? [])
    .filter(item => item && typeof item.key === "string" && typeof item.title === "string")
    .slice(0, healthTopic.aiCandidateLimit)
    .map(item => ({
      key: cleanText(item.key, 120),
      title: cleanText(item.title, 180),
      source: cleanText(item.source, 40),
      rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : undefined,
    }))

  if (!items.length) {
    return { enabled: false, model: healthTopic.aiModel, matches: [] }
  }

  const ai = getAI(event)
  if (!ai?.run) {
    return {
      enabled: false,
      model: healthTopic.aiModel,
      matches: [],
      error: "Workers AI binding is not available",
    }
  }

  const lines = items.map(item => JSON.stringify(item)).join("\n")
  const systemPrompt = `你是“健康管理”主题的信息筛选器。你只判断新闻标题与个人健康管理的相关性，不提供医学诊断。\n\n应该纳入：\n- 运动、健身、步行、跑步、力量训练、久坐、体能与健康结果\n- 减脂、减重、肥胖、体重、体脂、腰围、代谢、GLP-1 等体重管理\n- 营养、饮食、蛋白质、热量、维生素、膳食模式\n- 睡眠、失眠、打鼾、昼夜节律\n- 血糖、血压、血脂、心血管、糖尿病、脂肪肝等慢病管理\n- 体检、疫苗、预防医学、公共卫生、心理健康\n- 与上述主题直接相关的医学研究、指南、政策和重要健康事件\n\n应该排除：\n- 纯体育比赛、球队、比分、转会、电竞，除非核心内容是伤病、训练科学或健康\n- 明星八卦和社会奇闻，仅出现医院、医生、疾病等词但没有健康管理价值的内容\n- 医美、美容、保健品、减肥产品等明显营销内容\n- 与个人健康管理没有实质关系的泛医疗公司、资本市场或商业新闻\n\n只返回真正相关且相关度不低于 ${healthTopic.aiThreshold} 的项目。score 为 0-100 的健康管理相关度。category 只能是 exercise、weight、nutrition、sleep、metabolic、cardiovascular、preventive、medical_research、public_health、mental_health、other_health。\n\n必须返回合法 JSON，格式严格为：{"items":[{"key":"原 key","score":85,"category":"exercise"}]}。如果没有相关项目，返回 {"items":[]}。不要返回解释文字。`

  try {
    const result = await ai.run(healthTopic.aiModel, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请筛选以下候选标题，每行是一个 JSON 对象：\n${lines}`,
        },
      ],
      temperature: 0.1,
      reasoning_effort: "low",
      max_completion_tokens: 4096,
      stream: false,
    })

    const parsed = parseModelPayload(result)
    const validKeys = new Set(items.map(item => item.key))
    const matches = Array.isArray(parsed?.items)
      ? parsed.items
          .filter((item: any) => validKeys.has(String(item?.key)) && Number(item?.score) >= healthTopic.aiThreshold)
          .map((item: any) => ({
            key: String(item.key),
            score: Math.min(100, Math.max(0, Math.round(Number(item.score)))),
            category: categories.includes(item.category) ? item.category : "other_health",
          }))
      : []

    return {
      enabled: true,
      model: healthTopic.aiModel,
      matches,
    }
  } catch (error) {
    logger.error("Workers AI GLM health semantic classify failed", error)
    return {
      enabled: false,
      model: healthTopic.aiModel,
      matches: [],
      error: error instanceof Error ? error.message : "Workers AI classification failed",
    }
  }
})
