import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { isPublishedSource } from "../../shared/public-site"
import { intelligenceAttachmentDiscoveryVersion } from "../../server/utils/intelligence-parser"
import { enrichOfficialArticleMetadata } from "./enrich-article"
import { collectionSourceCatalog, resolveCollectionSource } from "./source-config-client"
import { collectionItemAllowed } from "./collection-scope"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const limit = Number(option("--limit", "24"))
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Attachment backfill limit must be 1–100")

const root = resolve(import.meta.dirname, "../..")
const outputDir = resolve(root, ".data/mac-batch")
await mkdir(outputDir, { recursive: true })
const snapshot = JSON.parse(await readFile(resolve(root, ".data/mac-batch/published.json"), "utf8"))
let batch: any = { articles: [], decisions: [], states: [] }
try {
  batch = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
} catch (error: any) {
  if (error.code !== "ENOENT") throw error
}

const ledgerPath = resolve(outputDir, "attachment-backfill.json")
let ledger: any = { checked: {}, failures: {} }
try {
  ledger = JSON.parse(await readFile(ledgerPath, "utf8"))
} catch (error: any) {
  if (error.code !== "ENOENT") throw error
}
ledger.checked ??= {}
ledger.failures ??= {}

// The preceding collection process already pinned a validated configuration to its LKG file.
const catalog = await collectionSourceCatalog(true)
const configured = await Promise.all(catalog.filter(source => isPublishedSource(source)).map(source => resolveCollectionSource(source, true)))
const sources = new Map(configured.filter(isPublishedSource).map(source => [source.id, source]))
function needsCurrentAttachmentCheck(article: any) {
  const checked = ledger.checked[article.key]
  const currentCheck = checked && Number(checked.discoveryVersion ?? 1) >= intelligenceAttachmentDiscoveryVersion
  return sources.has(article.sourceId) && collectionItemAllowed(article, configured)
    && !(article.attachments?.length ?? 0)
    && !currentCheck
    && (ledger.failures[article.key]?.attempts ?? 0) < 3
}
const candidates = snapshot.articles
  .filter(needsCurrentAttachmentCheck)
  .sort((a: any, b: any) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || (b.collectedAt ?? 0) - (a.collectedAt ?? 0))
  .slice(0, limit)

const updates: { key: string, attachments: { title: string, url: string }[] }[] = []
let cursor = 0
await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
  while (cursor < candidates.length) {
    const article: any = candidates[cursor++]
    let source = sources.get(article.sourceId)!
    const original = catalog.find(item => item.id === article.sourceId)!
    if (new URL(article.url).hostname !== new URL(source.home).hostname
      && new URL(article.url).hostname === new URL(original.home).hostname) {
      source = { ...source, home: original.home }
    }
    try {
      const metadata = await enrichOfficialArticleMetadata(source, article, {
        title: article.title,
        url: article.url,
        column: article.column,
        publishedAt: article.publishedAt,
        attachments: [],
      })
      ledger.checked[article.key] = { at: Date.now(), attachments: metadata.attachments.length, discoveryVersion: intelligenceAttachmentDiscoveryVersion }
      delete ledger.failures[article.key]
      if (metadata.attachments.length) updates.push({ key: article.key, attachments: metadata.attachments })
    } catch (error: any) {
      const previous = ledger.failures[article.key] ?? { attempts: 0 }
      ledger.failures[article.key] = { attempts: previous.attempts + 1, at: Date.now(), error: String(error?.message ?? error).slice(0, 200) }
    }
  }
}))

const ledgerPending = `${ledgerPath}.pending`
await writeFile(ledgerPending, `${JSON.stringify(ledger, null, 2)}\n`)
await rename(ledgerPending, ledgerPath)

if (updates.length) {
  const merged = new Map<string, { key: string, attachments: { title: string, url: string }[] }>()
  for (const update of [...(batch.attachmentUpdates ?? []), ...updates]) merged.set(update.key, update)
  batch.attachmentUpdates = [...merged.values()]
  const pending = resolve(outputDir, "result.pending.json")
  await writeFile(pending, `${JSON.stringify(batch, null, 2)}\n`)
  await rename(pending, resolve(outputDir, "result.json"))
}

console.log(JSON.stringify({ checked: candidates.length, restored: updates.length, remainingUnchecked: snapshot.articles.filter(needsCurrentAttachmentCheck).length }))
