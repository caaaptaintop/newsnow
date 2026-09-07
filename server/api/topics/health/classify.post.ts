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
  model?: string
  matches: AIHealthMatch[]
  error?: string
}

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
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

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function normalizeAIResponse(result: any): any {
  const payload = result?.response ?? result
  if (typeof payload !== "string") return payload

  const cleaned = payload
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  return JSON.parse(cleaned)
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

  if (!items.length) return { enabled: false, matches: [] }

  const ai = (event.context as any)?.cloudflare?.env?.AI
  if (!ai?.run) {
    return {
      enabled: false,
      matches: [],
      error: "Workers AI binding is not available",
    }
  }

  const numbered = items.map((item, index) => {
    const sourcePart = item.source ? ` | 来源:${item.source}` : ""
    const rankPart = item.rank ? ` | 原榜:${item.rank}` : ""
    return `${index}. [${item.key}] ${item.title}${sourcePart}${rankPart}`
  }).join("\n")

  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 100 },
            category: { type: "string", enum: [...categories] },
          },
          required: ["key", "score", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  }

  const systemPrompt = `你是健康管理信息流的语义筛选器。你的任务不是做医学诊断，而是判断新闻标题是否值得进入“健康管理”主题。\n\n应纳入：\n- 运动、体能、步行、跑步、力量训练、久坐、身体活动与健康结果\n- 减脂、减重、肥胖、体重、体脂、代谢、GLP-1 等体重管理\n- 营养、饮食、蛋白质、热量、膳食模式\n- 睡眠、失眠、昼夜节律\n- 血糖、血压、血脂、心血管、糖尿病、脂肪肝等慢病管理\n- 体检、疫苗、预防医学、公共卫生、心理健康\n- 与上述主题直接相关的高质量医学/健康研究和政策\n\n应排除：\n- 纯体育比赛、球队、运动员赛果，除非核心内容是健康/伤病/训练科学\n- 明星八卦、社会奇闻，仅因出现“医院”“医生”等词并不算健康管理\n- 美容、医美、保健品或减肥产品软广\n- 与个人健康管理没有实质关系的泛医疗商业新闻\n\n只返回真正相关的项目。score 表示“与健康管理主题的相关度”，0-100；${healthTopic.aiThreshold} 分以上才应返回。不要因为标题里没有关键词就漏掉语义明显相关的内容。`

  try {
    const result = await ai.run(MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请筛选下面这些候选标题。返回 key、score、category。\n\n${numbered}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: schema,
      },
      temperature: 0.1,
      max_tokens: 2400,
    })

    const parsed = normalizeAIResponse(result)
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
      model: MODEL,
      matches,
    }
  } catch (error) {
    logger.error("health semantic classify failed", error)
    return {
      enabled: false,
      matches: [],
      error: error instanceof Error ? error.message : "AI classification failed",
    }
  }
})
