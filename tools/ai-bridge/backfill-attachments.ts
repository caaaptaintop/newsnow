import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { intelligenceSources } from "../../shared/official-sources"
import { enrichOfficialArticleMetadata } from "./enrich-article"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const limit = Number(option("--limit", "24"))
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Attachment backfill limit must be 1–100")

const root = resolve(import.meta.dirname, "../..")
const outputDir = resolve(root, ".data/mac-batch")
await mkdir(outputDir, { recursive: true })
const snapshot = JSON.parse(await readFile(resolve(root, "data/intelligence-snapshot.json"), "utf8"))
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

const sources = new Map(intelligenceSources.filter(source => source.enabled && !source.newsnowId).map(source => [source.id, source]))
const candidates = snapshot.articles
  .filter((article: any) => {
    if (!sources.has(article.sourceId) || (article.attachments?.length ?? 0) > 0 || ledger.checked[article.key]) return false
    return (ledger.failures[article.key]?.attempts ?? 0) < 3
  })
  .sort((a: any, b: any) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || (b.collectedAt ?? 0) - (a.collectedAt ?? 0))
  .slice(0, limit)

const updates: { key: string, attachments: { title: string, url: string }[] }[] = []
let cursor = 0
await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
  while (cursor < candidates.length) {
    const article: any = candidates[cursor++]
    const source = sources.get(article.sourceId)!
    try {
      const metadata = await enrichOfficialArticleMetadata(source, article, {
        title: article.title,
        url: article.url,
        column: article.column,
        publishedAt: article.publishedAt,
        attachments: [],
      })
      ledger.checked[article.key] = { at: Date.now(), attachments: metadata.attachments.length }
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

console.log(JSON.stringify({ checked: candidates.length, restored: updates.length, remainingUnchecked: Math.max(0, snapshot.articles.filter((article: any) => sources.has(article.sourceId) && !(article.attachments?.length ?? 0) && !ledger.checked[article.key] && (ledger.failures[article.key]?.attempts ?? 0) < 3).length) }))
