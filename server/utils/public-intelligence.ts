import { createError } from "h3"
import { intelligenceSnapshot } from "@shared/intelligence-snapshot"
import { intelligenceSources } from "@shared/official-sources"
import { intelligenceDedupe, type IntelligenceTopic } from "@shared/intelligence"
import { intelligenceMetadataOnly } from "@shared/intelligence-storage"
import { isPublishedSource, isPublishedTopic } from "@shared/public-site"
import type { PublicIntelligenceFeed } from "@shared/public-intelligence"
import { getIntelligenceStore } from "./intelligence-store"

// One bounded, per-isolate result. No attachment bytes or AI execution. D1 migration
// and SQL pagination are a subsequent phase; the current 5,000-item scope is explicit.
const cached = new Map<IntelligenceTopic, { until: number, data: Promise<PublicIntelligenceFeed> }>()
export async function publicIntelligenceFeed(topic: IntelligenceTopic): Promise<PublicIntelligenceFeed> {
  if (!isPublishedTopic(topic)) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  const previous = cached.get(topic)
  if (previous && previous.until > Date.now()) return previous.data
  const data = load(topic)
  cached.set(topic, { until: Date.now() + 60000, data })
  try { return await data } catch (error) { if (cached.get(topic)?.data === data) cached.delete(topic); throw error }
}
async function load(topic: IntelligenceTopic): Promise<PublicIntelligenceFeed> {
  const sources = intelligenceSources.filter(source => source.topic === topic && isPublishedSource(source))
  const store = await getIntelligenceStore()
  const runtime = await store.articles(topic)
  const snapshot = intelligenceSnapshot.articles.filter(article => article.topic === topic)
  const merged = intelligenceDedupe(intelligenceSnapshot.pipeline === "mac" ? [...snapshot, ...runtime] : [...runtime, ...snapshot])
  const articles = merged.slice(0, 5000).map(value => {
    const { model: _model, analysisVersion: _analysisVersion, ...article } = intelligenceMetadataOnly(value)
    if (intelligenceSnapshot.pipeline === "mac" && article.publicationDate?.status !== "verified") article.publishedAt = undefined
    return article
  })
  const publicSources = sources.map(({ id, name, home, group, region, city }) => ({ id, name, home, group, region, city }))
  // A source-status-only batch must not cause a full public feed download.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([articles, publicSources])))
  const version = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("")
  return { topic, version, updatedAt: intelligenceSnapshot.generatedAt || undefined, articles, sources: publicSources, truncated: merged.length > 5000 }
}
