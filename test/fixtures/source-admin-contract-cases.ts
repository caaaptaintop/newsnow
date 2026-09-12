import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { H3Event } from "h3"
import { intelligenceSources } from "../../shared/official-sources"
import { intelligenceSourceSeedConfig, intelligenceSourceConfigHash, intelligenceSourceConfigJson, sourceConfigEnvelope, validateIntelligenceSourceConfig, type SourceDraftBase, type IntelligenceSourceConfig } from "../../shared/source-config"
import { publishSourceDraft, publishedBuildingSourceOverrides, rollbackSourceConfig, saveSourceDraft, saveSourceTest, sourceAdminModel } from "../../server/utils/source-config-store"
import { pendingRuntimeSourceTests, saveRuntimeSourceTest } from "../../server/source-admin/runtime-source-test"
import { sourceTestAllowsPublish, testSourceConfig } from "../../server/source-admin/test-source-config"

export const sourceAdminSeed = intelligenceSources.find(source => source.id === "official-beijing")!
export function syntheticSourceConfig(): IntelligenceSourceConfig {
  return { ...intelligenceSourceSeedConfig(sourceAdminSeed), collectionMode: "explicit" as const,
    endpoints: [{ id: "synthetic-notice", kind: "notice" as const, name: "合成测试栏目", url: `${sourceAdminSeed.home}synthetic-notices/`, enabled: true }] }
}
/** Real SQLite statements and transactions; only the transport API is simulated. */
export function memorySourceDatabase() {
  const sqlite = new DatabaseSync(":memory:")
  const hooks: { beforeBatch?: () => void, loseResponse?: boolean } = {}
  const calls: string[] = []
  const statement = (sql: string, values: any[] = []): any => ({
    sql, values, bind: (...values: any[]) => statement(sql, values),
    all: async () => { calls.push(sql); return { results: sqlite.prepare(sql).all(...values) } },
    run: async () => { calls.push(sql); return sqlite.prepare(sql).run(...values) },
  })
  const db = { prepare: statement, batch: async (statements: any[]) => {
    const hook = hooks.beforeBatch
    hooks.beforeBatch = undefined
    hook?.()
    sqlite.exec("BEGIN")
    let result
    try {
      result = statements.map(stmt => { calls.push(stmt.sql); return { results: sqlite.prepare(stmt.sql).all(...stmt.values) } })
      sqlite.exec("COMMIT")
    }
    catch (error) { sqlite.exec("ROLLBACK"); throw error }
    if (hooks.loseResponse) { hooks.loseResponse = false; throw new Error("Synthetic lost response after commit") }
    return result
  } }
  const event = { context: { env: { NEWSNOW_DB: db } } } as unknown as H3Event
  const count = (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n)
  return { event, db, sqlite, hooks, count, calls }
}
export function successfulSourceTest(config = syntheticSourceConfig()) {
  return { schemaVersion: 1, mode: "explicit", ok: true, publishable: true,
    endpoints: config.endpoints.filter(e => e.enabled).map(e => ({ id: e.id, name: e.name, url: e.url, finalUrl: e.url, ok: true, count: 1,
      preview: [{ title: "建筑合成回归测试通知，不是生产文章", url: `${sourceAdminSeed.home}synthetic-article.html` }], message: "合成解析结果" })), message: "合成测试" }
}
const owner = "synthetic-owner@example.com", topic = "building", id = sourceAdminSeed.id
const emptyBase: SourceDraftBase = { draftHash: null, activeRevision: 0 }
async function ready(f: ReturnType<typeof memorySourceDatabase>, config = syntheticSourceConfig(), base = emptyBase) {
  const draft = await saveSourceDraft(f.event, topic, id, config, owner, base)
  const testedAt = Date.now()
  await saveSourceTest(f.event, topic, id, draft.config, successfulSourceTest(config), owner, { draftHash: draft.hash, activeRevision: draft.activeRevision }, testedAt)
  return { ...draft, testedAt }
}
const cases: [string, (f: ReturnType<typeof memorySourceDatabase>) => Promise<void>][] = [
  ["first catalog reads do not initialize or mutate D1", async (f) => {
    assert.deepEqual(await publishedBuildingSourceOverrides(f.event), [])
    assert.deepEqual(await pendingRuntimeSourceTests(f.event, 1), { jobs: [] })
    const model = await sourceAdminModel(f.event, topic)
    assert.ok(model.sources.length > 0)
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get()!.n, 0)
    assert.ok(f.calls.every(sql => !/\b(CREATE|INSERT|UPDATE|DELETE)\b/.test(sql)))
  }],
  ["save draft rejects stale editors without overwriting", async (f) => {
    const d = await ready(f)
    await assert.rejects(saveSourceDraft(f.event, topic, id, { ...d.config, name: "stale edit" }, owner, emptyBase), { statusCode: 409 })
    assert.equal(f.sqlite.prepare("SELECT draft_hash FROM intelligence_source_config_entry").get()!.draft_hash, d.hash)
    assert.equal(f.count("intelligence_source_config_guard"), 0)
  }],
  ["publish is idempotent and does not change article data", async (f) => {
    f.sqlite.exec("CREATE TABLE building_docs_v3(id TEXT,data TEXT); INSERT INTO building_docs_v3 VALUES('original','unchanged')")
    const d = await ready(f)
    assert.equal((await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)).revision, 1)
    assert.equal((await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)).repeated, true)
    assert.equal(f.count("intelligence_source_config_revision"), 1)
    assert.equal(f.sqlite.prepare("SELECT data FROM building_docs_v3").get()!.data, "unchanged")
    assert.equal(f.count("intelligence_source_config_guard"), 0)
  }],
  ["R1 concurrent edit after pre-read leaves no orphan revision", async (f) => {
    const d = await ready(f)
    const changed = { ...d.config, name: "newer draft" }, hash = await intelligenceSourceConfigHash(changed)
    f.hooks.beforeBatch = () => { f.sqlite.prepare("UPDATE intelligence_source_config_entry SET draft_json=?,draft_hash=?").run(intelligenceSourceConfigJson(changed), hash) }
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt), { statusCode: 409 })
    assert.equal(f.count("intelligence_source_config_revision"), 0)
    assert.equal(f.sqlite.prepare("SELECT active_revision FROM intelligence_source_config_entry").get()!.active_revision, null)
    assert.equal(f.sqlite.prepare("SELECT draft_hash FROM intelligence_source_config_entry").get()!.draft_hash, hash)
    assert.equal(f.count("intelligence_source_config_guard"), 0)
  }],
  ["atomic publish rechecks test result within transaction", async (f) => {
    const d = await ready(f)
    f.hooks.beforeBatch = () => { f.sqlite.prepare("UPDATE intelligence_source_config_test SET ok=0,result_json='{}'").run() }
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt), { statusCode: 409 })
    assert.equal(f.count("intelligence_source_config_revision"), 0)
  }],
  ["failure after inserting history rolls entire transaction back", async (f) => {
    const d = await ready(f)
    f.sqlite.exec("CREATE TRIGGER synthetic_failure BEFORE UPDATE OF active_revision ON intelligence_source_config_entry BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END")
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt), { statusCode: 503 })
    assert.equal(f.count("intelligence_source_config_revision"), 0)
    assert.equal(f.count("intelligence_source_config_guard"), 0)
  }],
  ["lost publish response resolves to exact committed revision", async (f) => {
    const d = await ready(f)
    f.hooks.loseResponse = true
    const result = await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)
    assert.equal(result.revision, 1); assert.equal(result.repeated, true)
    assert.equal(f.count("intelligence_source_config_revision"), 1)
  }],
  ["concurrent identical publications have one revision", async (f) => {
    const d = await ready(f)
    const results = await Promise.all([0, 1].map(() => publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)))
    assert.deepEqual(results.map(r => r.revision), [1, 1]); assert.equal(f.count("intelligence_source_config_revision"), 1)
  }],
  ["restore only creates a draft and never publishes history", async (f) => {
    const d = await ready(f)
    await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)
    const next = await ready(f, { ...d.config, name: "second config" }, { draftHash: d.hash, activeRevision: 1 })
    await publishSourceDraft(f.event, topic, id, next.hash, owner, 1, next.testedAt)
    const result = await rollbackSourceConfig(f.event, topic, id, 1, owner, { draftHash: next.hash, activeRevision: 2 })
    assert.equal(result.hash, d.hash); assert.equal(result.activeRevision, 2)
    assert.equal(f.count("intelligence_source_config_revision"), 2)
    assert.equal((await publishedBuildingSourceOverrides(f.event))[0].name, "second config")
  }],
  ["R2 discovery ok and fabricated feed cannot pass publication gate", async (f) => {
    const config = { ...syntheticSourceConfig(), collectionMode: "discover" as const, endpoints: [] }
    assert.throws(() => validateIntelligenceSourceConfig({ ...config, collectionMode: "feed" }, sourceAdminSeed), /读取器/)
    const d = await saveSourceDraft(f.event, topic, id, config, owner, emptyBase), now = Date.now()
    await saveSourceTest(f.event, topic, id, d.config, { schemaVersion: 1, mode: "discover", ok: true, publishable: true, endpoints: [] }, owner, { draftHash: d.hash, activeRevision: 0 }, now)
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, now), { statusCode: 409 })
    assert.equal(f.count("intelligence_source_config_revision"), 0)
  }],
  ["cloud DNS fallback can be completed by the signed Mac test path without bypassing the publication contract", async (f) => {
    const config = syntheticSourceConfig()
    const draft = await saveSourceDraft(f.event, topic, id, config, owner, emptyBase)
    const queuedAt = Date.now() - 20
    const pending = { schemaVersion: 1 as const, mode: "explicit", ok: false, publishable: false, executor: "cloud" as const, runtimePending: true, message: "等待Mac复核",
      endpoints: config.endpoints.map(endpoint => ({ ...endpoint, ok: false, count: 0, preview: [], status: "failed" as const, message: "Cloudflare DNS", diagnostic: { stage: "fetch" as const, httpStatus: 530, category: "cloudflare_dns" as const, cloudflareCode: "1016" } })) }
    await saveSourceTest(f.event, topic, id, draft.config, pending, owner, { draftHash: draft.hash, activeRevision: 0 }, queuedAt)
    const jobs = await pendingRuntimeSourceTests(f.event, 1)
    assert.equal(jobs.jobs.length, 1)
    assert.equal(jobs.jobs[0].hash, draft.hash)
    assert.equal(jobs.jobs[0].sourceId, id)
    await assert.rejects(publishSourceDraft(f.event, topic, id, draft.hash, owner, 0, queuedAt), { statusCode: 409 })
    const startedAt = Date.now()
    const saved = await saveRuntimeSourceTest(f.event, "mac-synthetic", { topic, sourceId: id, hash: draft.hash, activeRevision: 0, requestedAt: queuedAt, startedAt, result: successfulSourceTest(config) })
    assert.equal(saved.publishable, true)
    assert.equal((await pendingRuntimeSourceTests(f.event, 1)).jobs.length, 0)
    assert.equal((await publishSourceDraft(f.event, topic, id, draft.hash, owner, 0, saved.testedAt)).revision, 1)
  }],
  ["signed Mac result cannot create a publishable test without the exact pending cloud request", async (f) => {
    const config = syntheticSourceConfig()
    const draft = await saveSourceDraft(f.event, topic, id, config, owner, emptyBase)
    await assert.rejects(saveRuntimeSourceTest(f.event, "mac-synthetic", { topic, sourceId: id, hash: draft.hash, activeRevision: 0, requestedAt: Date.now() - 20, startedAt: Date.now(), result: successfulSourceTest(config) }), { statusCode: 409 })
  }],
  ["stale Mac test result cannot overwrite a changed draft", async (f) => {
    const config = syntheticSourceConfig()
    const draft = await saveSourceDraft(f.event, topic, id, config, owner, emptyBase)
    const pending = { schemaVersion: 1 as const, mode: "explicit", ok: false, publishable: false, executor: "cloud" as const, runtimePending: true, message: "等待Mac复核",
      endpoints: config.endpoints.map(endpoint => ({ ...endpoint, ok: false, count: 0, preview: [], status: "failed" as const, message: "Cloudflare DNS", diagnostic: { stage: "fetch" as const, httpStatus: 530, category: "cloudflare_dns" as const } })) }
    const queuedAt = Date.now() - 20
    await saveSourceTest(f.event, topic, id, draft.config, pending, owner, { draftHash: draft.hash, activeRevision: 0 }, queuedAt)
    await saveSourceDraft(f.event, topic, id, { ...config, name: "newer config" }, owner, { draftHash: draft.hash, activeRevision: 0 })
    await assert.rejects(saveRuntimeSourceTest(f.event, "mac-synthetic", { topic, sourceId: id, hash: draft.hash, activeRevision: 0, requestedAt: queuedAt, startedAt: Date.now(), result: successfulSourceTest(config) }), { statusCode: 409 })
  }],
  ["expired tests and mismatched testedAt cannot publish", async (f) => {
    const d = await ready(f)
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt - 1), { statusCode: 409 })
    const old = Date.now() - 3_600_001
    f.sqlite.prepare("UPDATE intelligence_source_config_test SET tested_at=?").run(old)
    await assert.rejects(publishSourceDraft(f.event, topic, id, d.hash, owner, 0, old), { statusCode: 409 })
  }],
  ["an old test cannot overwrite a newer test or a newer draft", async (f) => {
    const d = await ready(f)
    await assert.rejects(saveSourceTest(f.event, topic, id, d.config, successfulSourceTest(), owner, { draftHash: d.hash, activeRevision: 0 }, d.testedAt - 1), { statusCode: 409 })
    const next = await saveSourceDraft(f.event, topic, id, { ...d.config, name: "changed" }, owner, { draftHash: d.hash, activeRevision: 0 })
    await assert.rejects(saveSourceTest(f.event, topic, id, d.config, successfulSourceTest(), owner, { draftHash: d.hash, activeRevision: 0 }, Date.now()), { statusCode: 409 })
    assert.notEqual(next.hash, d.hash)
  }],
  ["disabled source can publish without contacting a broken website", async (f) => {
    const config = { ...syntheticSourceConfig(), enabled: false, collectionMode: "discover" as const, endpoints: [] }
    const result = await testSourceConfig(config)
    assert.equal(sourceTestAllowsPublish(config, result), true)
    const d = await saveSourceDraft(f.event, topic, id, config, owner, emptyBase), now = Date.now()
    await saveSourceTest(f.event, topic, id, d.config, result, owner, { draftHash: d.hash, activeRevision: 0 }, now)
    await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, now)
    assert.equal((await publishedBuildingSourceOverrides(f.event))[0].enabled, false)
  }],
  ["catalog fingerprint changes for edits without changing source count", async (f) => {
    const d = await ready(f)
    await publishSourceDraft(f.event, topic, id, d.hash, owner, 0, d.testedAt)
    const old = await sourceConfigEnvelope(await publishedBuildingSourceOverrides(f.event))
    const next = await ready(f, { ...d.config, name: "second config" }, { draftHash: d.hash, activeRevision: 1 })
    await publishSourceDraft(f.event, topic, id, next.hash, owner, 1, next.testedAt)
    const latest = await sourceConfigEnvelope(await publishedBuildingSourceOverrides(f.event))
    assert.equal(old.sources.length, latest.sources.length); assert.notEqual(old.revision, latest.revision)
  }],
]
export const sourceAdminContractCases = cases.map(([name, execute]) => ({ name, run: async () => {
  const f = memorySourceDatabase()
  try { await execute(f) } finally { f.sqlite.close() }
} }))
