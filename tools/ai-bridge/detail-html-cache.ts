import { intelligenceCanonicalUrl } from "../../shared/intelligence"

interface CachedDetail {
  html: string
  url: string
  publishedAt?: number
}

const cache = new Map<string, CachedDetail>()

export function detailCacheKey(sourceId: string, url: string): string {
  const canonical = intelligenceCanonicalUrl(url) || url
  return `${sourceId}::${canonical}`
}

export function getCachedDetail(sourceId: string, url: string): CachedDetail | undefined {
  return cache.get(detailCacheKey(sourceId, url))
}

export function setCachedDetail(sourceId: string, url: string, detail: CachedDetail): void {
  cache.set(detailCacheKey(sourceId, url), detail)
}

export function clearDetailCache(): void {
  cache.clear()
}
