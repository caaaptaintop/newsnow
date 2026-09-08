import type { IntelligenceArticle } from "./intelligence"

/** Deliberately not configurable by an incoming HTTP request. */
export const intelligenceStoragePolicy = Object.freeze({
  schemaVersion: 2,
  saveBody: false,
  saveHtml: false,
  downloadAttachments: false,
  r2Enabled: false,
  attachmentMode: "links_only",
} as const)

/** Explicit allowlist: a future parser cannot accidentally persist raw content. */
export function intelligenceMetadataOnly(article: IntelligenceArticle): IntelligenceArticle {
  return {
    key: article.key, topic: article.topic, title: article.title, url: article.url,
    sourceId: article.sourceId, sourceName: article.sourceName, sourceGroup: article.sourceGroup,
    sourceLevel: article.sourceLevel, region: article.region, city: article.city, column: article.column,
    publisher: article.publisher, publishedAt: article.publishedAt ?? undefined,
    collectedAt: article.collectedAt, documentNo: article.documentNo,
    attachments: article.attachments.map(({ title, url }) => ({ title, url })),
    category: article.category, relatedCategories: [...article.relatedCategories], tags: [...article.tags],
    contentType: article.contentType, importance: article.importance, summary: article.summary,
    reason: article.reason, evidence: article.evidence, model: article.model,
    analysisVersion: article.analysisVersion,
    otherSources: article.otherSources?.map(({ name, url }) => ({ name, url })),
  }
}
