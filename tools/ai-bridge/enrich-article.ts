import "./custom-source-http"
import type { IntelligenceArticle, IntelligenceSource } from "../../shared/intelligence"
import { type OfficialCandidate, intelligenceFetchHtml, intelligenceParseArticle } from "../../server/utils/intelligence-parser"
import { getCachedDetail } from "./detail-html-cache"

export type OfficialArticleEnrichment = Pick<IntelligenceArticle, "publisher" | "documentNo" | "attachments"> & {
  text?: string
  mediaOnly?: boolean
}

function persistedMetadata(enrichment: OfficialArticleEnrichment): Pick<IntelligenceArticle, "publisher" | "documentNo" | "attachments"> {
  return {
    publisher: enrichment.publisher,
    documentNo: enrichment.documentNo,
    attachments: enrichment.attachments.map(({ title, url }) => ({ title, url })),
  }
}

/**
 * One official-page parse for classify-time body and persisted metadata.
 * Raw HTML stays in this call; callers must not write `text` to pending/result.
 */
export async function enrichOfficialArticle(
  source: IntelligenceSource,
  article: Pick<IntelligenceArticle, "url">,
  candidate: OfficialCandidate,
): Promise<OfficialArticleEnrichment> {
  if (source.newsnowId) return { publisher: undefined, documentNo: undefined, attachments: [] }
  const cached = getCachedDetail(source.id, article.url)
  const page = cached ? { html: cached.html, url: cached.url } : await intelligenceFetchHtml(article.url, source)
  const parsed = intelligenceParseArticle(page.html, candidate, source)
  return {
    publisher: parsed.publisher,
    documentNo: parsed.documentNo,
    attachments: parsed.attachments,
    ...(parsed.text ? { text: parsed.text } : {}),
    ...(parsed.mediaOnly ? { mediaOnly: true } : {}),
  }
}

export function officialArticlePersistedMetadata(
  enrichment: OfficialArticleEnrichment,
): Pick<IntelligenceArticle, "publisher" | "documentNo" | "attachments"> {
  return persistedMetadata(enrichment)
}

export async function enrichOfficialArticlesForClassify<T extends {
  key: string
  url: string
  title: string
  column: string
  publishedAt?: number
}>(
  source: IntelligenceSource,
  items: T[],
  concurrency = 5,
): Promise<{ enrichments: Map<string, OfficialArticleEnrichment>, fetchFailed: number, insufficient: number, mediaOnly: number }> {
  const enrichments = new Map<string, OfficialArticleEnrichment>()
  if (source.newsnowId || !items.length) return { enrichments, fetchFailed: 0, insufficient: 0, mediaOnly: 0 }
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!
      try {
        enrichments.set(item.key, await enrichOfficialArticle(source, item, {
          title: item.title,
          url: item.url,
          column: item.column,
          publishedAt: item.publishedAt,
          attachments: [],
        }))
      } catch { /* Title fallback is recorded by the caller. */ }
    }
  }))
  return {
    enrichments,
    fetchFailed: items.length - enrichments.size,
    insufficient: [...enrichments.values()].filter(item => !item.text && !item.mediaOnly).length,
    mediaOnly: [...enrichments.values()].filter(item => !item.text && item.mediaOnly).length,
  }
}

/**
 * The Mac subscription pipeline classifies titles, but article metadata still
 * comes from the official page. This keeps attachment links, document numbers,
 * and publishers without persisting raw HTML or body text.
 */
export async function enrichOfficialArticleMetadata(
  source: IntelligenceSource,
  article: Pick<IntelligenceArticle, "url">,
  candidate: OfficialCandidate,
): Promise<Pick<IntelligenceArticle, "publisher" | "documentNo" | "attachments">> {
  return persistedMetadata(await enrichOfficialArticle(source, article, candidate))
}
