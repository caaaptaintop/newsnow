import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { createHash, generateKeyPairSync, verify } from "node:crypto"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import { basename } from "node:path"
import process from "node:process"
import { buildingHash, normalizeBatchItem } from "../../shared/building-contract"

const pair = JSON.parse(await readFile(new URL("./fujian-protocol-pair.json", import.meta.url), "utf8"))
const disk = new Map<string, string>()
const identity = generateKeyPairSync("ed25519")
const requests: any[] = []
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
    return { writeFile: (value: string) => fs.writeFile(path, value), async close() {} }
  },
}
Object.assign(globalThis, { recoveryTestFs: fs, recoveryPair: pair })
const fakeFs = `data:text/javascript,${encodeURIComponent("export const {readFile,writeFile,rename,chmod,mkdir,unlink,open}=globalThis.recoveryTestFs")}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/tools/ai-bridge/")) {
      if (specifier === "node:fs/promises") return { url: fakeFs, shortCircuit: true }
      if (specifier === "./collect-source") return { url: `data:text/javascript,${encodeURIComponent("export async function collectSource(){return {items:[globalThis.recoveryPair.pending],warnings:[],columns:[]}}")}`, shortCircuit: true }
      if (specifier === "./local-codex.mjs") return { url: `data:text/javascript,${encodeURIComponent("export async function localCodex(){throw new Error('MODEL MUST NOT RUN')} ")}`, shortCircuit: true }
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
  return Response.json(body.action === "version" ? { revision: 17 } : body.action === "known" ? { records: [{ key: pair.retained.key, title: pair.retained.title }] } : { ok: true })
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
  const published = requests.filter(r => r.action === "publish").flatMap(r => r.items)
  assert.deepEqual(published.filter(item => item.kind === "article").map(item => item.key), withAttachments ? [pair.retained.key] : [])
  assert(!requests.some(r => r.batchId === "stale_alias"))
  assert.deepEqual(JSON.parse(disk.get("published.json")!).articles, [{ ...pair.retained, ...(withAttachments ? { attachments } : {}) }])
  console.log(JSON.stringify({ scenario: "apply-publisher", withAttachments, requests }))
  const count = requests.length
  await import(`../../tools/ai-bridge/apply-batch.ts?replay=${withAttachments}`)
  assert.deepEqual(requests.slice(count).map(r => r.action), ["maintain"])
  assert.equal(JSON.parse(disk.get("publish-outbox.json")!), null)
}
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
assert.equal(collected.articles.length, 0)
console.log(JSON.stringify({ scenario: "collector-known", requests, state: collected.states[0] }))
console.log("RECOVERY_INTEGRATION_PASS")
