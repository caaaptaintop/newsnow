import type { IntelligenceArticle, IntelligenceSource } from "../../shared/intelligence"
import { intelligenceFetchHtml, intelligenceParseArticle, type OfficialCandidate } from "../../server/utils/intelligence-parser"

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
  if (source.newsnowId) return { publisher: undefined, documentNo: undefined, attachments: [] }
  const page = await intelligenceFetchHtml(article.url, source)
  const parsed = intelligenceParseArticle(page.html, candidate, source)
  return { publisher: parsed.publisher, documentNo: parsed.documentNo, attachments: parsed.attachments }
}
