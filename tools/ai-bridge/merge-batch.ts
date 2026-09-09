import { isPublishedSource } from "../../shared/public-site"
import { createHash } from "node:crypto"
import { type IntelligenceArticle, intelligenceCanonicalUrl, intelligenceHttpUrl, intelligenceVersion } from "../../shared/intelligence"
import { intelligenceMetadataOnly } from "../../shared/intelligence-storage"
import { intelligenceSources } from "../../shared/official-sources"
import { intelligenceNormalizeDecision } from "../../server/utils/intelligence-ai"
import { buildingRecallScore } from "../../shared/building-recall"

export function mergeBatch(snapshot: any, batch: any) {
  if (!Array.isArray(snapshot.articles) || !Array.isArray(batch.articles) || !Array.isArray(batch.decisions)) throw new Error("Invalid snapshot or batch")
  const rawAttachmentUpdates = batch.attachmentUpdates ?? []
  if (!Array.isArray(rawAttachmentUpdates)) throw new Error("Invalid attachment updates")
  const snapshotByKey = new Map(snapshot.articles.map((article: any) => [article.key, article]))
  const attachmentUpdates = new Map<string, { title: string, url: string }[]>()
  for (const update of rawAttachmentUpdates) {
    const current: any = update && typeof update.key === "string" ? snapshotByKey.get(update.key) : undefined
    if (!current || !Array.isArray(update.attachments) || update.attachments.length > 16) throw new Error("Invalid attachment update")
    const seen = new Set<string>()
    const attachments = update.attachments.map((attachment: any) => {
      const safe = attachment && typeof attachment.title === "string" && attachment.title.trim().length <= 240 ? intelligenceHttpUrl(attachment.url) : undefined
      if (!safe) throw new Error("Invalid attachment update")
      const key = intelligenceCanonicalUrl(safe) || safe
      if (seen.has(key)) return undefined
      seen.add(key)
      return { title: attachment.title.trim() || "原文附件", url: safe }
    }).filter((value: { title: string, url: string } | undefined): value is { title: string, url: string } => !!value)
    if (JSON.stringify(current.attachments ?? []) !== JSON.stringify(attachments)) attachmentUpdates.set(update.key, attachments)
  }
  const existing = new Set(snapshot.articles.map((a: any) => a.key))
  const added: IntelligenceArticle[] = []
  for (const article of batch.articles) {
    if (existing.has(article.key)) continue
    const source = intelligenceSources.find(s => s.id === article.sourceId && isPublishedSource(s))
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
  const states = new Map((snapshot.states ?? []).map((s: any) => [s.id, s]))
  let changed = added.length > 0 || attachmentUpdates.size > 0 || (batch.pipeline === "mac" && snapshot.pipeline !== "mac")
  for (const state of batch.states ?? []) {
    const registered = intelligenceSources.find(source => source.id === state.id)
    if (registered && !isPublishedSource(registered)) continue
    if (!intelligenceSources.some(s => s.id === state.id) || !["ok", "partial", "error"].includes(state.status) || !Number.isFinite(state.checkedAt)) throw new Error("Invalid source state")
    const old: any = states.get(state.id)
    if (!old || state.checkedAt > (old.checkedAt ?? 0)) {
      states.set(state.id, state)
      changed = true
    }
  }
  const preserved = snapshot.articles.map((article: any) => attachmentUpdates.has(article.key) ? { ...article, attachments: attachmentUpdates.get(article.key)! } : article)
  return { ...snapshot, ...(batch.pipeline === "mac" ? { pipeline: "mac" } : {}), generatedAt: changed ? Date.now() : snapshot.generatedAt, states: [...states.values()], articles: [...preserved, ...added] }
}
