import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { intelligenceSources } from "../../shared/official-sources"
import { intelligenceCanonicalUrl } from "../../shared/intelligence"
import { collectSource } from "./collect-source"
import { verifyPublicationDate } from "./publication-date"

const root = resolve(import.meta.dirname, "../..")
const directory = resolve(root, ".data/publication-dates")
await mkdir(directory, { recursive: true })
const snapshot = JSON.parse(await readFile(resolve(root, "data/intelligence-snapshot.json"), "utf8"))
await writeFile(resolve(directory, "before.json"), JSON.stringify(snapshot))
const sources = new Map(intelligenceSources.map(source => [source.id, source]))
const lists = new Map<string, Map<string, any>>()
const sourceQueue = intelligenceSources.filter(source => !source.newsnowId && snapshot.articles.some((a: any) => a.sourceId === source.id))
await Promise.all(Array.from({ length: 5 }, async () => {
  while (sourceQueue.length) {
    const source = sourceQueue.shift()!
    try {
      const collected = await collectSource(source)
      lists.set(source.id, new Map(collected.items.map((item: { url: string }) => [intelligenceCanonicalUrl(item.url), item])))
    } catch { /* The article page will still be checked independently. */ }
  }
}))
const queue = [...snapshot.articles]
const cache = new Map<string, ReturnType<typeof verifyPublicationDate>>()
const report: any[] = []
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const article = queue.shift()!
    const source = sources.get(article.sourceId)
    if (!source) throw new Error(`Unconfigured source: ${article.sourceId}`)
    const key = intelligenceCanonicalUrl(article.url)
    const candidate = lists.get(source.id)?.get(key)
    if (!cache.has(key)) cache.set(key, verifyPublicationDate(source, { url: article.url, publishedAt: candidate?.publishedAt }, !!candidate))
    const result = await cache.get(key)!
    report.push({ key: article.key, topic: article.topic, sourceId: article.sourceId, url: article.url, previous: article.publishedAt, ...result })
    Object.assign(article, result)
    if (report.length % 50 === 0) console.log(JSON.stringify({ checked: report.length, total: snapshot.articles.length }))
  }
}))
snapshot.generatedAt = Date.now()
await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2))
await writeFile(resolve(directory, "audited-snapshot.json"), JSON.stringify(snapshot))
if (process.argv.includes("--apply")) {
  const payload = JSON.stringify(snapshot)
  await writeFile(resolve(root, "data/intelligence-snapshot.json"), `${payload}\n`)
  const modulePath = resolve(root, "shared/intelligence-snapshot.ts")
  const module = await readFile(modulePath, "utf8")
  const marker = "export const intelligenceSnapshot: IntelligenceSnapshot = "
  if (!module.includes(marker)) throw new Error("Snapshot module marker missing")
  await writeFile(modulePath, `${module.slice(0, module.indexOf(marker))}${marker}${payload}\n`)
}
console.log(JSON.stringify({ total: report.length, verified: report.filter(row => row.publicationDate.status === "verified").length, unknown: report.filter(row => row.publicationDate.status === "unknown").length, applied: process.argv.includes("--apply") }))
