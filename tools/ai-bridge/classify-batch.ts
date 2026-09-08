import { intelligenceClassify } from "../../server/utils/intelligence-ai"
import type { IntelligenceTopic } from "../../shared/intelligence"

/** Short per-request IDs prevent model transcription errors in long URL hashes. */
export async function classifyBatch(ai: any, topic: IntelligenceTopic, items: { key: string, title: string, column: string }[]) {
  const inputs = items.map((item, index) => ({ ...item, key: `item-${index + 1}` }))
  const decisions = await intelligenceClassify(ai, topic, inputs)
  if (decisions.size !== items.length) throw new Error("Incomplete classifications; no results saved")
  return new Map(items.map((item, index) => {
    const decision = decisions.get(inputs[index].key)
    if (!decision) throw new Error("Classification ID mismatch; no results saved")
    return [item.key, { ...decision, key: item.key }] as const
  }))
}
