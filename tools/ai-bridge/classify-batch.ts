import { healthEditorialPrompt } from "../../shared/health-editorial"
import { healthTopicLines, healthTopicTriggers } from "../../shared/topics"
import { type IntelligenceDecision, intelligenceClassify, intelligenceParseAI } from "../../server/utils/intelligence-ai"
import type { IntelligenceTopic } from "../../shared/intelligence"

/** Short per-request IDs prevent model transcription errors in long URL hashes. */
export async function classifyBatch(ai: any, topic: IntelligenceTopic, items: { key: string, title: string, column: string }[]) {
  const inputs = items.map((item, index) => ({ ...item, key: `item-${index + 1}` }))
  const decisions = topic === "health" ? await classifyHealth(ai, inputs) : await intelligenceClassify(ai, topic, inputs)
  if (decisions.size !== items.length) throw new Error("Incomplete classifications; no results saved")
  return new Map(items.map((item, index) => {
    const decision = decisions.get(inputs[index].key)
    if (!decision) throw new Error("Classification ID mismatch; no results saved")
    return [item.key, { ...decision, key: item.key }] as const
  }))
}

async function classifyHealth(ai: any, inputs: { key: string, title: string }[]) {
  const response = await ai.run(ai.model, { messages: [{ role: "system", content: healthEditorialPrompt }, { role: "user", content: JSON.stringify(inputs) }] })
  const keys = new Set(inputs.map(i => i.key))
  const matches = new Map<string, IntelligenceDecision>()
  for (const item of intelligenceParseAI(response)) {
    const raw = item as Record<string, any>
    if (!raw || !keys.has(raw.key) || matches.has(raw.key) || !Object.hasOwn(healthTopicLines, raw.primaryLine)
      || !Number.isFinite(Number(raw.score)) || typeof raw.angle !== "string" || !raw.angle.trim() || typeof raw.reason !== "string") {
      throw new Error("Invalid health classification")
    }
    matches.set(raw.key, { key: raw.key, keep: true, category: raw.primaryLine, relatedCategories: (Array.isArray(raw.auxiliaryLines) ? raw.auxiliaryLines : []).filter((c: string) => Object.hasOwn(healthTopicLines, c) && c !== raw.primaryLine).slice(0, 2), tags: (Array.isArray(raw.triggers) ? raw.triggers : []).filter((t: string) => Object.hasOwn(healthTopicTriggers, t)).slice(0, 2).map((t: keyof typeof healthTopicTriggers) => healthTopicTriggers[t]), contentType: "热点选题", importance: Math.max(0, Math.min(100, Number(raw.score))), summary: raw.angle.trim().slice(0, 110), reason: raw.reason.trim().slice(0, 130) })
  }
  return new Map(inputs.map(item => [item.key, matches.get(item.key) ?? { key: item.key, keep: false, category: "", relatedCategories: [], tags: [], contentType: "", importance: 0, summary: "", reason: "未满足健宁事实桥梁选题规则" }]))
}
