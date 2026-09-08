import { healthEditorialPrompt as systemPrompt } from "@shared/health-editorial"
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
