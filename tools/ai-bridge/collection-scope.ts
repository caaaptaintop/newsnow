import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceSourceCollectionScope as collectionScopeKey } from "../../shared/source-config"

export { intelligenceSourceCollectionScope as collectionScopeKey } from "../../shared/source-config"
export function collectionSourceAllowed(id: string, sources: readonly IntelligenceSource[] = []) {
  return sources.some(source => source.id === id && source.enabled)
}
export function collectionItemAllowed(item: { sourceId: string, column?: string }, sources: readonly IntelligenceSource[] = []) {
  return sources.some(source => source.id === item.sourceId && source.enabled && source.columns?.some(c => c.name === item.column))
}

/** Keep excluded records on disk and preserve all previously published articles. */
export function scopedPublicationBatch(snapshot: any, batch: any, sources: readonly IntelligenceSource[] = []) {
  const existing = new Map<string, any>(snapshot.articles.map((a: any) => [a.key, a]))
  return {
    ...batch,
    articles: batch.articles.filter((a: any) => collectionItemAllowed(a, sources) && (existing.has(a.key) || sources.some(source => source.id === a.sourceId && a.collectionScope === collectionScopeKey(source)))),
    decisions: batch.decisions.filter((d: any) => collectionSourceAllowed(d.sourceId, sources)),
    states: (batch.states ?? []).filter((s: any) => collectionSourceAllowed(s.id, sources)),
    attachmentUpdates: (batch.attachmentUpdates ?? []).filter((u: any) => {
      const article = existing.get(u?.key)
      if (!article) throw new Error("附件更新对象不存在，保留批次等待核验")
      return collectionItemAllowed(article, sources)
    }),
  }
}
