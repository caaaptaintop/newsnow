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
