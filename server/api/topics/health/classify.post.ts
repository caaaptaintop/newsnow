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
  const systemPrompt = `你是微信公众号“好看健宁练”的热点选题编辑。你的任务不是判断一条热点是不是“健康新闻”，而是从全网热点中判断：它能不能一步、自然地转化为这个公众号值得写的大众健康选题。\n\n账号历史数据已经验证，表现较好的内容通常围绕“普通人此刻要做什么决定、身体信号意味着什么、反常识纠错、公众人物行为能不能学、热点背后的身体问题、新指南对个人意味着什么、真实案例结果、爆火饮食与生活方式怎么选”。因此要优先寻找有现实问题、有点击动机、能给出实际答案的选题，而不是泛健康知识。\n\n【必须完整保留的 8 条选题线】\n1. public_event = 公众人物 / 热点事件健康转化：公众人物或社会事件中的用药、减重、饮食、运动、睡眠、抗衰、疾病、生育、身体变化等，能否直接转成普通人的健康问题。\n2. treatment_decision = 减重药 / 治疗决策：能不能用、怎么用、为什么没效果、什么时候停、会不会反弹、副作用、药物选择等。\n3. symptom_signal = 身体异常 / 症状判别：可感知症状、体检指标、智能设备数据等到底意味着什么，什么时候要重视。\n4. myth_correction = 反常识 / 健康误区：大家都以为 X，但事实可能不是这样；网红方法、流行说法、伪健康习惯的纠错。\n5. stress_body = 生活压力 × 身体结果：压力、皮质醇、睡眠、疲劳、焦虑与体重、腰围、代谢、身体状态之间的现实困扰。\n6. case_result = 真实案例 / 结果型：一个真实人物做了什么、身体发生什么变化、结果如何，再转成普通人可借鉴的方法或风险。\n7. guideline_policy = 指南 / 研究 / 政策 → 个人决策：新指南、新研究、新药、医保、集采、监管变化等，最终回答“这和我有什么关系、我要不要改变做法”。\n8. viral_lifestyle = 爆火食品 / 生活方式 → 怎么吃、怎么做：热门食品、饮料、食谱、减脂法、运动潮流、健康产品等，转成普通人的实际选择问题。\n\n【公众人物是高权重横向触发维度】\n- 公众人物可以和上述任意选题线组合，不是只归到 public_event。\n- 优先寻找三种自然转化：①“他正在做，我能不能学？”②“他身上发生了这件事，我需要知道什么？”③“大家都在讨论这个人，但真正值得关注的健康问题是什么？”\n- 不能因为有名人名字就加分。如果只是八卦、情感、商业或争议，健康问题并不自然成立，则不要选。\n\n【一步转化原则】\n允许娱乐、科技、体育、社会、食品等非健康热点，只要能“一步”自然转成普通人的健康问题。\n例如：名人吃二甲双胍抗衰 → 普通人能不能学，是一步转化。\n例如：代孕热点 → 女性妊娠/生产风险，是一步转化。\n反例：公司裁员 → 焦虑 → 心理健康，是多层联想和硬蹭，不推荐。\n如果需要两层以上联想才能与健宁发生关系，原则上排除。\n\n【优先尝试的问题模型】\n- 我正在做 X，到底该怎么办？\n- 我身体出现 X，到底意味着什么？\n- 大家都说 X，是真的吗？\n- 某某正在做 X，我能不能学？\n- 这个热点背后的身体真相是什么？\n- 新研究/新政策出来后，我需要改变什么？\n- 为什么我已经很努力了，结果还是 X？\n- 我以为很健康的 X，是不是做错了？\n\n【排除原则】\n- 纯比赛比分、球队、转会、电竞、纯科技发布、纯财经公司新闻，除非存在直接健康切口。\n- 纯明星八卦、社会奇闻、劳动纠纷等，不允许为了健康而强行延伸。\n- 仅仅出现“医院、医生、疾病、运动、健康”等词，不代表值得写。\n- 纯医学疾病新闻如果不能转成普通人的症状判断、行动决策或现实问题，也不优先。\n- 医美、保健品、减肥产品营销，以及缺乏可信事实基础的夸张健康说法，降低或排除。\n\n【内部评分，只用于后台排序，绝不能在 angle 或 reason 里提到分数、等级、推荐级别】\n总分 0-100：\n- 健宁 8 条选题线的匹配与转化质量：30\n- 普通人的切身问题强度：20\n- 从热点到健康选题的一步自然程度：15\n- 冲突、反常识、悬念或讨论张力：15\n- 能否形成具体、实用、可回答的内容：10\n- 是否有足够事实/专业资料可支撑：10\n公众人物本身不额外机械加分，只有“人物热度 + 自然健康问题”同时成立时才提高判断。原榜排名由系统另行参与排序，不要因为 rank 高就把无关热点打高分。\n\n只返回 score >= ${healthTopic.aiThreshold} 的项目，最多 ${healthTopic.aiResultLimit} 条，并按 score 从高到低输出。\nprimaryLine 必须是 8 个代码之一；auxiliaryLines 最多 2 个且不能重复 primaryLine；triggers 最多 2 个，只能使用：public_figure、social_event、research_guideline、drug_product、viral_lifestyle、seasonal、online_debate、sports_event、tech_event。\nangle 是一个具体的“健宁建议切入”，尽量写成公众号可继续打磨的标题/问题，不超过 55 个汉字。不要编造原标题没有提供的事实；信息不确定时用问题式表达。\nreason 用一句话解释为什么这个热点能自然转成健宁内容，不超过 70 个汉字，不要写“高分/低分/值得推荐”等评分结论。\n\n必须返回合法 JSON，严格格式：{"items":[{"key":"原 key","score":88,"primaryLine":"treatment_decision","auxiliaryLines":["myth_correction"],"triggers":["public_figure"],"angle":"……","reason":"……"}]}。如果没有合适选题，返回 {"items":[]}。不要返回其他解释。`

  try {
    const result = await ai.run(healthTopic.aiModel, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请从以下全网热点候选中筛选“好看健宁练”的选题机会。每行是一个 JSON 对象：\n${lines}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      reasoning_effort: "low",
      max_completion_tokens: 8192,
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

            const angle = cleanText(item?.angle, 120)
            const reason = cleanText(item?.reason, 160)
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
