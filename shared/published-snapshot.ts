import { isPublishedSource, isPublishedTopic } from "./public-site"
import { intelligenceSources } from "./official-sources"
import { intelligenceMetadataOnly } from "./intelligence-storage"
import type { IntelligenceSnapshot } from "./intelligence-snapshot"

export function publishedSnapshot(snapshot: IntelligenceSnapshot): IntelligenceSnapshot {
  const sourceIds = new Set(intelligenceSources.filter(isPublishedSource).map(source => source.id))
  return {
    pipeline: snapshot.pipeline,
    generatedAt: snapshot.generatedAt,
    articles: snapshot.articles.filter(article => isPublishedTopic(article.topic)).map(intelligenceMetadataOnly),
    states: snapshot.states.filter(state => sourceIds.has(state.id)),
    seen: Object.fromEntries(Object.entries(snapshot.seen ?? {}).filter(([id]) => sourceIds.has(id))),
  }
}
