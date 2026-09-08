import { createHash } from "node:crypto"
import { type IntelligenceArticle, intelligenceCanonicalUrl, intelligenceVersion } from "../../shared/intelligence"
import { intelligenceMetadataOnly } from "../../shared/intelligence-storage"
import { intelligenceSources } from "../../shared/official-sources"
import { intelligenceNormalizeDecision } from "../../server/utils/intelligence-ai"
import { buildingRecallScore } from "../../shared/building-recall"

export function mergeBatch(snapshot: any, batch: any) {
  if (!Array.isArray(snapshot.articles) || !Array.isArray(batch.articles) || !Array.isArray(batch.decisions)) throw new Error("Invalid snapshot or batch")
  const existing = new Set(snapshot.articles.map((a: any) => a.key))
  const added: IntelligenceArticle[] = []
  for (const article of batch.articles) {
    if (existing.has(article.key)) continue
    const source = intelligenceSources.find(s => s.id === article.sourceId && s.enabled)
    const key = `${source?.topic}:${createHash("sha256").update(intelligenceCanonicalUrl(article.url)).digest("hex")}`
    const decision = batch.decisions.find((d: any) => d.key === key && d.title === article.title && d.keep === true)
    if (!source || key !== article.key || source.topic !== article.topic || article.analysisVersion !== intelligenceVersion
      || !decision || !intelligenceNormalizeDecision({ ...article, keep: true }, new Set([key]), source.topic)
      || (source.topic === "building" && buildingRecallScore(article) <= 0)
      || !Number.isFinite(article.collectedAt) || article.evidence !== "title") {
      throw new Error("Batch article failed validation")
    }
    added.push(intelligenceMetadataOnly(article))
    existing.add(key)
  }
  return { ...snapshot, generatedAt: added.length ? Date.now() : snapshot.generatedAt, articles: [...snapshot.articles, ...added] }
}
