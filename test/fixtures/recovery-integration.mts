import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { createHash, generateKeyPairSync, verify } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import { basename } from "node:path"
import process from "node:process"
import { buildingHash, normalizeBatchItem } from "../../shared/building-contract"

const importFresh = (path: string) => import(path)

const pair = JSON.parse(await readFile(new URL("./fujian-protocol-pair.json", import.meta.url), "utf8"))
const disk = new Map<string, string>()
const identity = generateKeyPairSync("ed25519")
const requests: any[] = []
const titleCalls: number[] = []
const bodyCalls: number[] = []
const titleTest: any = { mode: "off", hidden: false, failKnown: false, items: [] }
Object.assign(globalThis, { titleTest, titleCalls, bodyCalls })
const summaries: any[] = []
const log = console.log
console.log = (...args) => {
  try {
    const value = JSON.parse(args[0])
    if (value.storage === "D1" && "publishedArticles" in value) summaries.push(value)
  } catch {}
  log(...args)
}
const fs = {
  async readFile(path: string) {
    const value = disk.get(basename(path))
    if (value === undefined) throw Object.assign(new Error("missing isolated fixture"), { code: "ENOENT" })
    return value
  },
  async writeFile(path: string, value: string) {
    disk.set(basename(path), value)
  },
  async rename(from: string, to: string) {
    disk.set(basename(to), disk.get(basename(from))!)
    disk.delete(basename(from))
  },
  async chmod() {},
  async mkdir() {},
  async unlink(path: string) {
    disk.delete(basename(path))
  },
  async open(path: string) {
    return { writeFile: (value: string) => fs.writeFile(path, value), async close() {}, async sync() {} }
  },
}
Object.assign(globalThis, { recoveryTestFs: fs, recoveryPair: pair })
const fakeFs = `data:text/javascript,${encodeURIComponent("export const {readFile,writeFile,rename,chmod,mkdir,unlink,open}=globalThis.recoveryTestFs")}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/tools/ai-bridge/")) {
      // Legacy multi-source recovery fixtures exercise alias/receipt semantics;
      // production authorization is independently covered by collection-scope.test.ts.
      if (specifier === "./source-config-client") return { url: `data:text/javascript,${encodeURIComponent("export const resolveCollectionSource=async(source)=>source;export const sourceConfigProvenance=async()=>({origin:'fixture'});")}`, shortCircuit: true }
      if (specifier === "./collection-scope") return { url: `data:text/javascript,${encodeURIComponent("export const collectionScopeKey=()=> 'fixture-scope';export const collectionSourceId='official-fujian';export const collectionSourceAllowed=()=>true;export const collectionItemAllowed=()=>true;export const assertCollectionColumns=()=>{};export const scopedPublicationBatch=(_snapshot,batch)=>batch;")}`, shortCircuit: true }
      if (specifier === "./antigravity-session.mjs") return { url: `data:text/javascript,${encodeURIComponent("export const agyModel=\"gemini-3.8-flash-low\"")}`, shortCircuit: true }
      if (specifier === "node:fs/promises") return { url: fakeFs, shortCircuit: true }
      if (specifier === "./collect-source") return { url: `data:text/javascript,${encodeURIComponent("export async function collectSource(source){return {items:globalThis.titleTest.mode==='off'?[globalThis.recoveryPair.pending]:globalThis.titleTest.hidden?[]:globalThis.titleTest.items.map(i=>['body-incomplete','transport-failure'].includes(globalThis.titleTest.mode)?{...i,sourceId:source.id,url:i.url+'?fixture_id='+source.id}:i),warnings:[],columns:[]}}")}`, shortCircuit: true }
      if (specifier === "./enrich-article") return { url: `data:text/javascript,${encodeURIComponent("export async function enrichOfficialArticlesForClassify(){return {enrichments:new Map(),fetchFailed:0,insufficient:0}};export function officialArticlePersistedMetadata(){return {}}")}`, shortCircuit: true }
      if (specifier === "./local-antigravity.mjs") {
        return { url: `data:text/javascript,${encodeURIComponent(`export async function localAntigravity(model,messages){
        if(globalThis.titleTest.mode==='off')throw new Error('MODEL MUST NOT RUN');
        const inputs=JSON.parse(messages[1].content),screen=messages[0].content.includes('标题初筛员');
        (screen?globalThis.titleCalls:globalThis.bodyCalls).push(inputs.length);
        if(globalThis.titleTest.mode==='transport-failure')throw new Error('AGY isolation check failed');
        if(globalThis.titleTest.mode==='invalid')return {items:[]};
        if(globalThis.titleTest.mode==='body-incomplete'&&!screen&&globalThis.bodyCalls.length===1)return {items:[]};
        if(globalThis.titleTest.mode==='original-title')return {items:inputs.map(i=>({key:i.key,keep:true,title:'AI擅自改写的标题',category:'good_housing',relatedCategories:[],tags:[],contentType:'通知公告',importance:80,summary:'住宅品质相关事项',reason:'住宅品质'}))};
        return {items:inputs.map(i=>({key:i.key,keep:screen&&['keep','body-incomplete'].includes(globalThis.titleTest.mode),reason:'隔离测试决定'}))};
      }`)}`, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})
// All fetch calls are intercepted. The actual publisher signs with an ephemeral in-memory identity.
globalThis.fetch = async (url: any, options: any) => {
  assert.equal(url.pathname, "/api/internal/building")
  const message = `POST\n${url.pathname}\n${options.headers["X-Building-Time"]}\n${createHash("sha256").update(options.body).digest("hex")}`
  assert(verify(null, Buffer.from(message), identity.publicKey, Buffer.from(options.headers["X-Building-Signature"], "base64")))
  const body = JSON.parse(options.body)
  requests.push(body)
  if (body.action === "known" && titleTest.failKnown) return new Response("unavailable", { status: 503 })
  return Response.json(body.action === "version" ? { revision: 17 } : body.action === "known" ? { records: titleTest.mode === "off" ? [{ key: pair.retained.key, title: pair.retained.title }] : [] } : { ok: true })
}
function reset() {
  disk.clear()
  requests.length = 0
  disk.set("private-key.pem", identity.privateKey.export({ format: "pem", type: "pkcs8" }).toString())
}
for (const withAttachments of [false, true]) {
  reset()
  const attachments = [{ title: "补充附件.docx", url: "https://zjt.fujian.gov.cn/files/test.docx" }]
  disk.set("published.json", JSON.stringify({ articles: [pair.retained], generatedAt: 1 }))
  disk.set("result.json", JSON.stringify({ articles: [pair.pending], decisions: [{ key: pair.pending.key, sourceId: pair.pending.sourceId, title: pair.pending.title, keep: true, at: 1789002200000 }], states: [], attachmentUpdates: withAttachments ? [{ key: pair.pending.key, attachments }] : [] }))
  disk.set("published-ledger.json", "{}")
  const staleItems = [normalizeBatchItem({ kind: "article", key: pair.pending.key, data: pair.pending })]
  disk.set("publish-outbox.json", JSON.stringify({ hash: await buildingHash(JSON.stringify(staleItems)), batchId: "stale_alias", baseRevision: 16, items: staleItems }))
  await import(`../../tools/ai-bridge/apply-batch.ts?attachments=${withAttachments}`)
  assert.equal(summaries.at(-1).publishedArticles, 0)
  assert.equal(summaries.at(-1).updatedArticles, withAttachments ? 1 : 0)
  const published = requests.filter(r => r.action === "publish").flatMap(r => r.items)
  assert.deepEqual(published.filter(item => item.kind === "article").map(item => item.key), withAttachments ? [pair.retained.key] : [])
  assert(!requests.some(r => r.batchId === "stale_alias"))
  assert.deepEqual(JSON.parse(disk.get("published.json")!).articles, [{ ...pair.retained, ...(withAttachments ? { attachments } : {}) }])
  console.log(JSON.stringify({ scenario: "apply-publisher", withAttachments, requests }))
  const count = requests.length
  await import(`../../tools/ai-bridge/apply-batch.ts?replay=${withAttachments}`)
  assert.equal(summaries.at(-1).publishedArticles, 0)
  assert.equal(summaries.at(-1).updatedArticles, 0)
  assert.deepEqual(requests.slice(count).map(r => r.action), ["maintain"])
  assert.equal(JSON.parse(disk.get("publish-outbox.json")!), null)
}
reset()
disk.set("published.json", JSON.stringify({ articles: [], generatedAt: 1 }))
disk.set("result.json", JSON.stringify({ articles: [pair.pending], decisions: [{ key: pair.pending.key, sourceId: pair.pending.sourceId, title: pair.pending.title, keep: true, at: 1789002200000 }], states: [] }))
await importFresh("../../tools/ai-bridge/apply-batch.ts?counts=new")
assert.equal(summaries.at(-1).publishedArticles, 1)
assert.equal(summaries.at(-1).updatedArticles, 0)
await importFresh("../../tools/ai-bridge/apply-batch.ts?counts=replay")
assert.equal(summaries.at(-1).publishedArticles, 0)
assert.equal(summaries.at(-1).updatedArticles, 0)
// R1: inspect actual signed publish requests, not just the outbox state.
const observeOnly = process.argv.includes("--observe-r1")
const A = { title: "A.pdf", url: "https://zjt.fujian.gov.cn/files/A.pdf" }
const B = { title: "B.pdf", url: "https://zjt.fujian.gov.cn/files/B.pdf" }
const C = { title: "C.pdf", url: "https://zjt.fujian.gov.cn/files/C.pdf" }
const mixedResults: any[] = []
for (const reverse of [false, true]) {
  for (const existing of [false, true]) {
    reset()
    const updates = [{ key: pair.pending.key, attachments: [B] }, { key: pair.retained.key, attachments: [C] }]
    const input = { articles: [pair.pending], decisions: [{ key: pair.pending.key, sourceId: pair.pending.sourceId, title: pair.pending.title, keep: true, at: 1789002200000 }], attachmentUpdates: reverse ? updates.reverse() : updates }
    disk.set("published.json", JSON.stringify({ articles: [{ ...pair.retained, attachments: existing ? [A] : [] }], generatedAt: 1 }))
    disk.set("result.json", JSON.stringify(input))
    disk.set("published-ledger.json", "{}")
    const staleItems = [normalizeBatchItem({ kind: "article", key: pair.pending.key, data: pair.pending })]
    disk.set("publish-outbox.json", JSON.stringify({ hash: await buildingHash(JSON.stringify(staleItems)), batchId: "stale_alias", baseRevision: 16, items: staleItems }))
    let firstContent: string | undefined
    for (let round = 0; round <= 4; round++) {
      const offset = requests.length
      await import(`../../tools/ai-bridge/apply-batch.ts?r1=${reverse}-${existing}-${round}`)
      const sent = requests.slice(offset)
      const publishes = sent.filter(r => r.action === "publish")
      const articleItems = publishes.flatMap(r => r.items).filter(item => item.kind === "article")
      const snapshot = JSON.parse(disk.get("published.json")!)
      const content = JSON.stringify(snapshot)
      const record = { scenario: "R1-mixed", reverse, existing, round, attachments: snapshot.articles[0].attachments, contentSha256: createHash("sha256").update(content).digest("hex"), publishRequests: publishes.length, articleItems, requests: sent }
      console.log(JSON.stringify(record))
      mixedResults.push(record)
      assert(!sent.some(r => r.batchId === "stale_alias"))
      assert(!articleItems.some(item => item.key === pair.pending.key))
      assert.equal(disk.get("result.json"), JSON.stringify(input))
      if (!observeOnly) {
        assert.deepEqual(snapshot.articles, [{ ...pair.retained, attachments: [...(existing ? [A] : []), B, C] }])
        if (round === 0) {
          assert.equal(publishes.length, 1)
          assert.deepEqual(articleItems, [normalizeBatchItem({ kind: "article", key: pair.retained.key, data: snapshot.articles[0] })])
          firstContent = content
        } else {
          assert.equal(content, firstContent)
          assert.equal(publishes.length, 0)
          assert.deepEqual(sent.map(r => r.action), ["maintain"])
        }
      }
    }
  }
}
console.log(JSON.stringify({ scenario: "R1-summary", observeOnly, rows: mixedResults.map(({ requests: _requests, articleItems: _items, ...row }) => row) }))
reset()
disk.set("published.json", JSON.stringify({ articles: [] }))
process.argv.push("--source", "official-fujian")
await import("../../tools/ai-bridge/mac-batch.ts")
const known = requests.find(r => r.action === "known")
assert.deepEqual(new Set(known.keys), new Set([pair.pending.key, pair.retained.key]))
const collected = JSON.parse(disk.get("result.json")!)
assert.equal(collected.states[0].status, "ok")
assert.equal(collected.states[0].accepted, 0)
assert.deepEqual(collected.states[0].collectionCounts, { discovered: 0, duplicates: 1, failed: 0 })
assert.equal(collected.articles.length, 0)
console.log(JSON.stringify({ scenario: "collector-known", requests, state: collected.states[0] }))

reset()
titleTest.mode = "invalid"
titleTest.items = [pair.pending]
process.argv = [process.argv[0], process.argv[1], "--source", "official-fujian,official-shanghai"]
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=invalid")
assert.equal(titleCalls.length, 2, "invalid classification keeps its candidates but allows subsequent source AI calls")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 2)
assert.equal(JSON.parse(disk.get("result.json")!).decisions.length, 0)

for (const mode of ["body-incomplete", "transport-failure"]) {
  reset()
  titleCalls.length = 0
  bodyCalls.length = 0
  titleTest.mode = mode
  disk.set("published.json", JSON.stringify({ articles: [] }))
  await importFresh(`../../tools/ai-bridge/mac-batch.ts?failure-scope=${mode}`)
  const result = JSON.parse(disk.get("result.json")!)
  if (mode === "body-incomplete") {
    assert.equal(titleCalls.length, 2)
    assert.equal(bodyCalls.length, 2, "incomplete body classifications do not pause the next source")
    assert.equal(result.pendingCandidates.length, 1, "failed source is kept for retry")
    assert.equal(result.decisions.length, 1, "next source completed")
  } else {
    assert.equal(titleCalls.length, 1, "provider isolation failure still stops all subsequent calls")
    assert.equal(result.pendingCandidates.length, 2)
    assert.equal(result.decisions.length, 0)
  }
}

reset()
titleCalls.length = 0
titleTest.mode = "reject"
titleTest.failKnown = true
process.argv = [process.argv[0], process.argv[1], "--source", "official-fujian"]
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=known-failure")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 1)
assert.equal(titleCalls.length, 0)
titleTest.failKnown = false
titleTest.hidden = true
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=known-recovery")
assert.equal(titleCalls.length, 1, "queued title survives disappearance from current list")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 0)
assert.equal(JSON.parse(disk.get("result.json")!).decisions.length, 1)

reset()
titleCalls.length = 0
bodyCalls.length = 0
titleTest.mode = "keep"
titleTest.hidden = false
titleTest.items = Array.from({ length: 31 }, (_, n) => ({ ...pair.pending, title: `住宅项目规范第${n}项通知`, url: `${pair.pending.url}?test=${n}` }))
process.argv = [process.argv[0], process.argv[1], "--source", "official-fujian", "--limit", "1"]
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=queue-first")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 30)
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=queue-second")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 29)
assert.deepEqual(titleCalls, [30, 1], "screened queued titles do not require another title AI call")
assert.deepEqual(bodyCalls, [1, 1])
reset()
titleCalls.length = 0
bodyCalls.length = 0
titleTest.mode = "keep"
titleTest.hidden = false
titleTest.items = [pair.pending, { ...pair.pending, title: `${pair.pending.title}修订版` }]
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=versions-first")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 1)
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates[0].title, titleTest.items[1].title)
assert.deepEqual(titleCalls, [1], "same-key versions are screened separately")
for (const round of ["second", "third", "fourth"]) {
  await importFresh(`../../tools/ai-bridge/mac-batch.ts?title=versions-${round}`)
  assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 0)
}
assert.deepEqual(titleCalls, [1, 1], "processed title versions never alternate back into AI")
assert.deepEqual(bodyCalls, [1, 1])
assert.equal(JSON.parse(disk.get("result.json")!).processedVersions.length, 2)
reset()
titleTest.mode = "invalid"
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=versions-fail")
assert.equal(JSON.parse(disk.get("result.json")!).pendingCandidates.length, 2)
reset()
titleTest.mode = "original-title"
titleTest.items = [pair.pending]
disk.set("published.json", JSON.stringify({ articles: [] }))
await importFresh("../../tools/ai-bridge/mac-batch.ts?title=preserve-original")
const originalResult = JSON.parse(disk.get("result.json")!)
assert.equal(originalResult.articles[0].title, pair.pending.title, "AI title cannot overwrite source title")
assert.equal(originalResult.decisions[0].title, pair.pending.title)
assert.equal(JSON.parse(disk.get("PENDING-classification.json")!).input[0].title, pair.pending.title)
console.log("RECOVERY_INTEGRATION_PASS")
