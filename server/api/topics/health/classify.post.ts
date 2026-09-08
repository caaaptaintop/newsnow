import {
  healthTopic,
  healthTopicLines,
  healthTopicTriggers,
  type HealthTopicLine,
  type HealthTopicTrigger,
} from "@shared/topics"

interface CandidateInput {
  key: string
  title: string
  source?: string
  rank?: number
}

interface AIHotTopicMatch {
  key: string
  /** 仅供后台筛选与排序，前端不展示。 */
  score: number
  primaryLine: HealthTopicLine
  auxiliaryLines: HealthTopicLine[]
  triggers: HealthTopicTrigger[]
  angle: string
  reason: string
}

interface ClassifyResponse {
  enabled: boolean
  model: string
  matches: AIHotTopicMatch[]
  error?: string
}

const lineCodes = Object.keys(healthTopicLines) as HealthTopicLine[]
const triggerCodes = Object.keys(healthTopicTriggers) as HealthTopicTrigger[]

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
  const systemPrompt = `你是微信公众号“好看健宁练”的热点选题编辑。不要做“健康新闻分类”，而要判断一个全网热点能否一步、自然地转成普通人愿意点开、且能给出实际答案的健宁选题。\n\n固定 8 条选题线，必须从中选 primaryLine，可再选最多 2 条 auxiliaryLines：\n- public_event：公众人物/热点事件健康转化\n- treatment_decision：减重药/治疗决策\n- symptom_signal：身体异常/症状判别\n- myth_correction：反常识/健康误区\n- stress_body：生活压力×身体结果\n- case_result：真实案例/结果型\n- guideline_policy：指南/研究/政策→个人决策\n- viral_lifestyle：爆火食品/生活方式→怎么吃、怎么做\n\n公众人物是高权重横向触发，但不能仅因“名人”而入选。优先考虑：他正在做，我能不能学；他身上发生了什么，我需要知道什么；这个人物热点背后真正的健康问题是什么。\n\n核心规则：\n1. 娱乐、科技、体育、社会、食品等非健康热点可以入选，但必须“一步”就能自然转成健康问题。\n2. 需要两层以上联想的硬蹭要排除，例如“公司裁员→焦虑→心理健康”。\n3. 纯八卦、劳动纠纷、比分转会、纯商业/资本新闻、只出现医院/医生/健康等词但没有个人决策价值的内容，排除。\n4. 优先能转成这些问题的热点：我该怎么办；这个身体信号意味着什么；大家都说 X 真的吗；名人的做法我能不能学；热点背后的身体真相；新研究/政策出来后我要改变什么；为什么努力了还没效果；我以为健康的做法是不是错了。\n5. 不编造原标题没有提供的事实；信息不足时，angle 用问题式表达。\n\n内部 score 只用于后台排序，前端绝不展示。评分重点：选题线匹配与转化质量30、普通人切身问题20、一步自然程度15、冲突/悬念15、可形成实用答案10、事实可支撑10。原榜 rank 由系统另行参与排序，不要因为排名高就给无关内容高分。\n\n只返回 score >= ${healthTopic.aiThreshold} 的项目，最多 ${healthTopic.aiResultLimit} 条，按 score 从高到低。triggers 最多2个，只能使用 public_figure、social_event、research_guideline、drug_product、viral_lifestyle、seasonal、online_debate、sports_event、tech_event。angle 不超过50个汉字；reason 不超过55个汉字，且不要写分数、等级或“强烈推荐”。\n\n严格返回 JSON：{"items":[{"key":"原key","score":88,"primaryLine":"treatment_decision","auxiliaryLines":["myth_correction"],"triggers":["public_figure"],"angle":"……","reason":"……"}]}。没有合适选题就返回 {"items":[]}。不要输出其他内容。`

  try {
    const result = await ai.run(healthTopic.aiModel, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `筛选以下热点候选，每行一个 JSON：\n${lines}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 6000,
      stream: false,
    })

    const parsed = parseModelPayload(result)
    const validKeys = new Set(items.map(item => item.key))
    const matches = Array.isArray(parsed?.items)
      ? parsed.items
          .map((item: any): AIHotTopicMatch | null => {
            const key = String(item?.key ?? "")
            const score = Math.min(100, Math.max(0, Math.round(Number(item?.score))))
            const primaryLine = String(item?.primaryLine ?? "") as HealthTopicLine
            if (!validKeys.has(key) || !Number.isFinite(score) || score < healthTopic.aiThreshold || !lineCodes.includes(primaryLine)) return null

            const auxiliaryLines = Array.isArray(item?.auxiliaryLines)
              ? item.auxiliaryLines
                  .map((value: unknown) => String(value) as HealthTopicLine)
                  .filter((value: HealthTopicLine, index: number, list: HealthTopicLine[]) => lineCodes.includes(value) && value !== primaryLine && list.indexOf(value) === index)
                  .slice(0, 2)
              : []

            const triggers = Array.isArray(item?.triggers)
              ? item.triggers
                  .map((value: unknown) => String(value) as HealthTopicTrigger)
                  .filter((value: HealthTopicTrigger, index: number, list: HealthTopicTrigger[]) => triggerCodes.includes(value) && list.indexOf(value) === index)
                  .slice(0, 2)
              : []

            const angle = cleanText(item?.angle, 110)
            const reason = cleanText(item?.reason, 130)
            if (!angle) return null

            return {
              key,
              score,
              primaryLine,
              auxiliaryLines,
              triggers,
              angle,
              reason,
            }
          })
          .filter((item: AIHotTopicMatch | null): item is AIHotTopicMatch => !!item)
          .sort((a: AIHotTopicMatch, b: AIHotTopicMatch) => b.score - a.score)
          .slice(0, healthTopic.aiResultLimit)
      : []

    return {
      enabled: true,
      model: healthTopic.aiModel,
      matches,
    }
  } catch (error) {
    logger.error("Workers AI Jianing hot-topic classify failed", error)
    return {
      enabled: false,
      model: healthTopic.aiModel,
      matches: [],
      error: error instanceof Error ? error.message : "Workers AI topic classification failed",
    }
  }
})
