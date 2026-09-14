import { createHash } from "node:crypto"
import { intelligenceCanonicalUrl } from "../../shared/intelligence"

// Preserve stored IDs; only this verified source treats HTTP/HTTPS as aliases.
export function batchArticleKeys(topic: string, sourceId: string, url: string) {
  const canonical = intelligenceCanonicalUrl(url)
  const urls = [canonical]
  if (canonical && topic === "building" && sourceId === "official-fujian") {
    const parsed = new URL(canonical)
    if (parsed.hostname === "zjt.fujian.gov.cn" && !parsed.port) {
      parsed.protocol = parsed.protocol === "https:" ? "http:" : "https:"
      urls.push(parsed.href)
    }
  }
  return urls.map(value => `${topic}:${createHash("sha256").update(value).digest("hex")}`)
}

export function pageHasUnprocessed(topic: string, sourceId: string, items: { url: string, title: string }[], records: { key: string, title: string }[]) {
  const known = new Set(records.map(record => JSON.stringify([record.key, record.title])))
  return items.some(item => batchArticleKeys(topic, sourceId, item.url).every(alias => !known.has(JSON.stringify([alias, item.title]))))
}
