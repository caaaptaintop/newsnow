import { configuredAI } from "../../../utils/ai-provider"
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
  /** 仅供后台排序，前端不展示。 */
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
  cacheKey?: string
}

const lineCodes = Object.keys(healthTopicLines) as HealthTopicLine[]
const triggerCodes = Object.keys(healthTopicTriggers) as HealthTopicTrigger[]
const stableSeed = 20260908
const maxParallelChunks = 8

function cleanText(value: unknown, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function getAI(event: any) {
  return configuredAI(event)
}

function parseModelPayload(result: any) {
  const raw = result?.choices?.[0]?.message?.content
    ?? result?.response
    ?? result

  if (raw && typeof raw === "object") return raw
  if (typeof raw !== "string") throw new Error("Workers AI returned an unsupported response")

  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{"items"')
    const end = cleaned.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {}
    }
    throw new Error("Workers AI did not return valid JSON")
  }
}

function normalizeMatch(item: any, validKeys: Set<string>): AIHotTopicMatch | null {
  const key = String(item?.key ?? "")
  const score = Math.min(100, Math.max(0, Math.round(Number(item?.score))))
  const primaryLine = String(item?.primaryLine ?? "") as HealthTopicLine

  if (!validKeys.has(key) || !Number.isFinite(score) || !lineCodes.includes(primaryLine)) return null

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
}

const systemPrompt = `你是微信公众号“好看健宁练”的热点选题编辑。你的任务不是“判断是不是健康新闻”，而是从全网热点里发现可以自然转化为健宁公众号内容的选题机会。\n\n固定保留以下 8 条选题线，必须从中选 primaryLine，可再选最多 2 条 auxiliaryLines：\n- public_event：公众人物/热点事件健康转化\n- treatment_decision：减重药/治疗决策\n- symptom_signal：身体异常/症状判别\n- myth_correction：反常识/健康误区\n- stress_body：生活压力×身体结果\n- case_result：真实案例/结果型\n- guideline_policy：指南/研究/政策→个人决策\n- viral_lifestyle：爆火食品/生活方式→怎么吃、怎么做\n\n最重要的编辑原则是“事实桥梁”：\nA. 允许“热点标题已经明确提供的事实 → 一个健康问题”的一步转化。\nB. 也允许事件本身天然包含身体或健康事实，即使标题不是传统健康新闻。例如：代孕、妊娠、分娩、生育、猝死、手术、骨折、患病、暴瘦、极端饮食、服药、医疗操作、明确的身体变化等，都可以直接作为事实桥梁。\nC. 禁止“热点事实 → AI 自己猜出的新事实 → 健康问题”的二次转化。不得为了蹭热点自行补出伤病、训练、恢复、心理压力、护肤方法、饮食习惯、疾病、用药等原标题没有提供的事实。\n\n明确示例：\n- “某公众人物代孕/代孕妈妈”可以保留：代孕本身已经直接涉及妊娠、分娩和女性身体风险，不需要脑补。\n- “某明星一个月暴瘦15斤”可以保留：暴瘦是标题明确提供的身体变化。\n- “某公众人物骑车锁骨骨折”可以保留：骨折是标题明确提供的健康事件。\n- “郑钦文逆转震惊美网”应排除：比赛结果本身不能让你自行补出训练、恢复、伤病或心理压力。\n- “某女星脸比珠宝还闪”应排除：不能自行补出护肤方法或皮肤健康问题。\n- “公司调岗裁员”应排除：不能通过“工作压力→焦虑→健康”多跳转化。\n- “病历被写刁蛮、医生被调查”这类医患管理/病历规范/维权事件应排除，除非标题本身还明确包含普通人的身体健康、生活方式或健康决策问题。医疗领域不等于健宁选题。\n\n公众人物是高权重横向触发，但不能仅因“名人”而入选。优先寻找：他正在做什么，我能不能学；他身上明确发生了什么身体/健康事件，普通人需要知道什么；这个热点事实本身是否已经带出普通人的健康决策。\n\n其他规则：\n1. 娱乐、科技、体育、社会、食品等非健康热点可以入选，但必须满足上述一步事实桥梁。\n2. 纯八卦、劳动纠纷、比分转会、纯商业/资本新闻、医疗管理纠纷，以及仅仅出现“医院/医生/健康”等词却没有个人健康决策价值的内容，排除。\n3. key 与 title 必须严格一一对应，绝不能把另一个标题的事实写到当前 key 的 angle 或 reason 中。\n4. 优先能转成这些问题：我该怎么办；这个身体信号意味着什么；大家都说 X 真的吗；名人的做法我能不能学；热点背后的身体真相；新研究/政策出来后我要改变什么；为什么努力了还没效果；我以为健康的做法是不是错了。\n5. 信息不足时，angle 用问题式表达，只能基于标题已知事实，不把推测写成事实。\n\n先按以上编辑规则独立决定 keep/drop。不要用固定分数门槛决定是否保留。只有决定保留以后，再给 score 0-100 作为后台排序信号；这个分数永远不会展示给用户。triggers 最多 2 个，只能使用 public_figure、social_event、research_guideline、drug_product、viral_lifestyle、seasonal、online_debate、sports_event、tech_event。angle 不超过50个汉字；reason 不超过55个汉字，不写分数、等级或“强烈推荐”。\n\n严格只输出 JSON：{"items":[{"key":"原key","score":88,"primaryLine":"treatment_decision","auxiliaryLines":["myth_correction"],"triggers":["public_figure"],"angle":"……","reason":"……"}]}。只输出你决定 keep 的项目；没有合适选题就输出 {"items":[]}。不要输出 Markdown，不要解释。`

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

  const ai = getAI(event)
  const cacheKey = JSON.stringify([ai.provider, ai.model, event.context.aiSettingsRevision ?? 0])
  if (!items.length) {
    return { enabled: false, model: ai.model, matches: [], cacheKey }
  }

  if (!ai?.run) {
    return {
      enabled: false,
      model: ai.model,
      matches: [],
      cacheKey,
      error: "AI provider configuration is not available",
    }
  }

  const run = ai.run
  const subscription = /^(codex|grok-subscription):/.test(ai.provider)
  const parallelChunks = subscription ? 1 : maxParallelChunks

  // AI 判断不依赖榜位：同一批标题即使名次小幅变化，也构造相同的模型输入。
  const modelItems = items
    .map(item => ({ key: item.key, title: item.title, source: item.source }))
    .sort((a, b) => `${a.key}|${a.title}`.localeCompare(`${b.key}|${b.title}`))

  const chunks: typeof modelItems[] = []
  for (let i = 0; i < modelItems.length; i += healthTopic.aiChunkSize) {
    chunks.push(modelItems.slice(i, i + healthTopic.aiChunkSize))
  }

  async function runChunk(chunk: typeof modelItems, index: number) {
    const lines = chunk.map(item => JSON.stringify(item)).join("\n")
    const params: any = {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `这是第 ${index + 1} 组，共 ${chunk.length} 条。逐条判断 keep/drop，只输出保留项目；每个输出 key 必须对应自己的 title。\n${lines}`,
        },
      ],
      temperature: 0,
      seed: stableSeed,
      max_completion_tokens: 2200,
      reasoning_effort: "low",
      chat_template_kwargs: { enable_thinking: false },
      stream: false,
    }

    let lastError: unknown
    // No implicit retry for any API or subscription provider, not only Proma.
    for (let attempt = 0; attempt < (ai.provider === "cloudflare" ? 2 : 1); attempt++) {
      try {
        const result = await run(ai.model, params)
        return { ok: true as const, parsed: parseModelPayload(result) }
      } catch (error) {
        lastError = error
      }
    }

    logger.error(`AI Jianing chunk ${index + 1} failed`, lastError)
    return { ok: false as const, error: lastError }
  }

  try {
    const chunkResults: Array<Awaited<ReturnType<typeof runChunk>>> = []

    // Subscription nodes serialize chunks; existing API/Workers parallelism is retained.
    for (let start = 0; start < chunks.length; start += parallelChunks) {
      const wave = chunks.slice(start, start + parallelChunks)
      const waveResults = await Promise.all(
        wave.map((chunk, offset) => runChunk(chunk, start + offset)),
      )
      chunkResults.push(...waveResults)
    }

    const successful = chunkResults.filter(result => result.ok)
    if (!successful.length) {
      return {
        enabled: false,
        model: ai.model,
        matches: [],
        cacheKey,
        error: chunkResults[0]?.error instanceof Error
          ? chunkResults[0].error.message : "AI topic classification failed",
      }
    }

    const validKeys = new Set(items.map(item => item.key))
    const merged = new Map<string, AIHotTopicMatch>()

    for (const result of successful) {
      if (!result.ok || !Array.isArray(result.parsed?.items)) continue
      for (const rawItem of result.parsed.items) {
        const item = normalizeMatch(rawItem, validKeys)
        if (!item) continue
        const previous = merged.get(item.key)
        if (!previous || item.score > previous.score) merged.set(item.key, item)
      }
    }

    const matches = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, healthTopic.aiResultLimit)

    return {
      enabled: true,
      model: ai.model,
      matches,
      cacheKey,
      error: successful.length < chunks.length ? `仅完成 ${successful.length}/${chunks.length} 批分析；未完成部分没有作为完整结果缓存，请检查 AI 状态。` : undefined,
    }
  } catch (error) {
    logger.error("AI Jianing hot-topic classify failed", error)
    return {
      enabled: false,
      model: ai.model,
      matches: [],
      cacheKey,
      error: error instanceof Error ? error.message : "AI topic classification failed",
    }
  }
})
