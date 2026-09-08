interface CandidateInput {
  key: string
  title: string
  source?: string
  rank?: number
}

interface ModelResult {
  model: string
  ok: boolean
  elapsedMs: number
  items: any[]
  error?: string
  rawPreview?: string
}

const AB_TOKEN = "jianing-ab-20260908-v1"
const MODELS = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/openai/gpt-oss-120b",
] as const
const CHUNK_SIZE = 10

function cleanText(value: unknown, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function getAI(event: any) {
  return event?.context?.cloudflare?.env?.AI || event?.context?.env?.AI
}

function modelText(result: any) {
  const raw = result?.choices?.[0]?.message?.content ?? result?.response ?? result
  return typeof raw === "string" ? raw : JSON.stringify(raw)
}

function parseModelPayload(result: any) {
  const raw = result?.choices?.[0]?.message?.content ?? result?.response ?? result
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

const systemPrompt = `你是微信公众号“好看健宁练”的热点选题编辑。不要做“健康新闻分类”，而要判断一个全网热点能否一步、自然地转成普通人愿意点开、且能给出实际答案的健宁选题。\n\n固定 8 条选题线，必须从中选 primaryLine，可再选最多 2 条 auxiliaryLines：\n- public_event：公众人物/热点事件健康转化\n- treatment_decision：减重药/治疗决策\n- symptom_signal：身体异常/症状判别\n- myth_correction：反常识/健康误区\n- stress_body：生活压力×身体结果\n- case_result：真实案例/结果型\n- guideline_policy：指南/研究/政策→个人决策\n- viral_lifestyle：爆火食品/生活方式→怎么吃、怎么做\n\n公众人物是高权重横向触发，但不能仅因“名人”而入选。优先考虑：他正在做，我能不能学；他身上发生了什么，我需要知道什么；这个人物热点背后真正的健康问题是什么。\n\n核心规则：\n1. 娱乐、科技、体育、社会、食品等非健康热点可以入选，但必须“一步”就能自然转成健康问题。\n2. 需要两层以上联想的硬蹭要排除，例如“公司裁员→焦虑→心理健康”。\n3. 纯八卦、劳动纠纷、比分转会、纯商业/资本新闻、只出现医院/医生/健康等词但没有个人决策价值的内容，排除。\n4. 仅凭标题明确表达的信息判断。严禁自行推测原标题没有出现的伤病、心理压力、恢复方案、饮食、训练、疾病、药物使用等事实。仅仅因为人物是运动员，不得自动转成运动健康选题。\n5. key 与 title 必须严格一一对应，绝不能把另一个标题的事实写到当前 key 的 angle 或 reason 中。\n6. 优先能转成这些问题的热点：我该怎么办；这个身体信号意味着什么；大家都说 X 真的吗；名人的做法我能不能学；热点背后的身体真相；新研究/政策出来后我要改变什么；为什么努力了还没效果；我以为健康的做法是不是错了。\n7. 信息不足时，angle 用问题式表达，不要把推测写成事实。\n\n内部 score 只用于排序。评分重点：选题线匹配与转化质量30、普通人切身问题20、一步自然程度15、冲突/悬念15、可形成实用答案10、事实可支撑10。原榜 rank 不决定 AI 分数。\n\n只返回 score >= 60 的项目。triggers 最多2个，只能使用 public_figure、social_event、research_guideline、drug_product、viral_lifestyle、seasonal、online_debate、sports_event、tech_event。angle 不超过50个汉字；reason 不超过55个汉字。\n\n严格只输出 JSON：{"items":[{"key":"原key","score":88,"primaryLine":"treatment_decision","auxiliaryLines":["myth_correction"],"triggers":["public_figure"],"angle":"……","reason":"……"}]}。没有合适选题就输出 {"items":[]}。不要输出 Markdown，不要解释。`

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string, items?: CandidateInput[] }>(event)
  if (body?.token !== AB_TOKEN) {
    setResponseStatus(event, 404)
    return { ok: false }
  }

  const items = (body?.items ?? [])
    .filter(item => item && typeof item.key === "string" && typeof item.title === "string")
    .slice(0, 100)
    .map(item => ({
      key: cleanText(item.key, 120),
      title: cleanText(item.title, 180),
      source: cleanText(item.source, 40),
      rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : undefined,
    }))
    .sort((a, b) => `${a.key}|${a.title}`.localeCompare(`${b.key}|${b.title}`))

  if (!items.length) return { ok: false, error: "no items" }
  const ai = getAI(event)
  if (!ai?.run) return { ok: false, error: "Workers AI binding is not available" }

  const chunks: typeof items[] = []
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE))
  }

  function paramsFor(model: string, userPrompt: string) {
    const params: any = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      stream: false,
      seed: 424242,
    }

    if (model.includes("gemma-4")) {
      params.max_completion_tokens = 2200
      params.reasoning_effort = "low"
      params.chat_template_kwargs = { enable_thinking: false }
    } else {
      params.max_tokens = 2200
    }
    return params
  }

  async function runModel(model: string): Promise<ModelResult> {
    const started = Date.now()
    const chunkResults = await Promise.all(chunks.map(async (chunk, index) => {
      let rawResult: any
      try {
        const lines = chunk.map(item => JSON.stringify(item)).join("\n")
        const prompt = `这是第 ${index + 1} 组，共 ${chunk.length} 条。逐条检查，只保留符合规则的项目；输出 key 必须对应自己的 title。\n${lines}`
        rawResult = await ai.run(model, paramsFor(model, prompt))
        const parsed = parseModelPayload(rawResult)
        return {
          ok: true,
          items: Array.isArray(parsed?.items) ? parsed.items : [],
          raw: cleanText(modelText(rawResult), 600),
        }
      } catch (error) {
        return {
          ok: false,
          items: [] as any[],
          error: error instanceof Error ? error.message : String(error),
          raw: rawResult ? cleanText(modelText(rawResult), 1000) : "",
        }
      }
    }))

    const merged = new Map<string, any>()
    for (const chunk of chunkResults) {
      for (const item of chunk.items) {
        const key = String(item?.key ?? "")
        const score = Number(item?.score ?? 0)
        if (!key || !Number.isFinite(score) || score < 60) continue
        const previous = merged.get(key)
        if (!previous || Number(previous.score ?? 0) < score) merged.set(key, item)
      }
    }

    const output = [...merged.values()]
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
      .slice(0, 30)
    const errors = chunkResults.filter(item => !item.ok).map(item => item.error).filter(Boolean)

    return {
      model,
      ok: errors.length === 0,
      elapsedMs: Date.now() - started,
      items: output,
      error: errors.length ? errors.join(" | ") : undefined,
      rawPreview: chunkResults.map((item, index) => `#${index + 1} ${item.raw}`).join(" || ").slice(0, 2400),
    }
  }

  const results = await Promise.all(MODELS.map(model => runModel(model)))
  return {
    ok: true,
    candidateCount: items.length,
    chunkSize: CHUNK_SIZE,
    results,
  }
})
