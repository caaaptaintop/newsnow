import { createHash } from "node:crypto"
import { expect, it } from "vitest"
import type { H3Event } from "h3"
import { createSourceDraft, publishSourceDraft, publishedBuildingSourceOverrides, saveSourceDraft, saveSourceTest } from "../server/utils/source-config-store"
import { activateBuilding, initializeBuilding, knownRecords, publishBatch } from "../server/building/store"
import { readPage } from "../server/building/read"
import { customSourceSeed, intelligenceSourceCollectionScope, sourceConfigEnvelope } from "../shared/source-config"
import { buildingHash, normalizeBatchItem } from "../shared/building-contract"
import { intelligenceVersion } from "../shared/intelligence"
import { mergeBatch } from "../tools/ai-bridge/merge-batch"
import { validateSourceEnvelope } from "../tools/ai-bridge/source-config-client"
import { successfulSourceTest } from "./fixtures/source-admin-contract-cases"
import { memoryBuildingDB } from "./helpers/building-db"

async function setup() {
  const f = memoryBuildingDB()
  const event = { context: { env: { NEWSNOW_DB: f.db } } } as unknown as H3Event
  await initializeBuilding(f.db)
  const created = await createSourceDraft(event, { name: "自定义来源集成验证", home: "https://example.com/" }, "test@example.com")
  const draft = await saveSourceDraft(event, "building", created.config.id, { ...created.config, enabled: true, endpoints: [{ id: "news", name: "建设动态", url: "https://example.com/news", kind: "news", enabled: true }] }, "test@example.com", { draftHash: created.hash, activeRevision: 0 })
  const at = Date.now()
  await saveSourceTest(event, "building", draft.config.id, draft.config, successfulSourceTest(draft.config), "test@example.com", { draftHash: draft.hash, activeRevision: 0 }, at)
  const url = "https://example.com/news/article.html"
  const key = `building:${createHash("sha256").update(url).digest("hex")}`
  const article = { key, topic: "building", title: "保留原标题：智能建造技术应用", url, sourceId: draft.config.id, sourceName: draft.config.name, sourceGroup: "公开来源", sourceLevel: "其他", region: "", city: "", column: "建设动态", collectedAt: at, publishedAt: at, publicationDate: { status: "verified", basis: "article", url, checkedAt: at }, category: "intelligent_construction", relatedCategories: [], tags: [], contentType: "行业动态", importance: 80, summary: "智能建造技术应用情况。", reason: "技术应用", evidence: "body", attachments: [], model: "synthetic-test", analysisVersion: intelligenceVersion }
  const item = normalizeBatchItem({ kind: "article", key, data: article })
  const sourceScopes = { [draft.config.id]: await buildingHash(intelligenceSourceCollectionScope(customSourceSeed(draft.config)!)) }
  const body = { sourceScopes, batchId: `test_${crypto.randomUUID()}`, baseRevision: 0, items: [item] }
  const approve = () => publishSourceDraft(event, "building", draft.config.id, draft.hash, "test@example.com", 0, at)
  return { ...f, event, draft, article, item, body, approve }
}
it("new source goes from draft/test to approved catalog, merge, publication, public read and dedupe", async () => {
  const f = await setup()
  try {
    await expect(publishBatch(f.db, "test", f.body, await publishedBuildingSourceOverrides(f.event))).rejects.toThrow("未启用")
    await f.approve()
    const configs = (await validateSourceEnvelope(await sourceConfigEnvelope(await publishedBuildingSourceOverrides(f.event)))).sources
    const source = customSourceSeed(configs[0])!
    const batch = { articles: [f.article], decisions: [{ ...f.article, keep: true }], states: [] }
    const merged = mergeBatch({ articles: [], states: [] }, batch, [source])
    expect(merged.articles[0].title).toBe(f.article.title)
    expect((await publishBatch(f.db, "test", f.body, configs)).revision).toBe(1)
    expect((await publishBatch(f.db, "test", f.body, configs)).repeated).toBe(true)
    await activateBuilding(f.db, 1, 1)
    const page = await readPage(f.db, new URLSearchParams(), Date.now(), [source])
    expect(page.total).toBe(1)
    expect(page.sources[0].id).toBe(source.id)
    expect(page.articles[0].title).toBe(f.article.title)
    expect((await knownRecords(f.db, [f.item.key])).records).toHaveLength(1)
  } finally {
    f.sqlite.close()
  }
})
it("revocation between configuration read and transaction prevents all article writes", async () => {
  const f = await setup()
  try {
    await f.approve()
    const configs = await publishedBuildingSourceOverrides(f.event)
    const originalBatch = f.db.batch.bind(f.db)
    f.db.batch = async (statements) => {
      f.sqlite.exec("UPDATE intelligence_source_config_entry SET active_revision=NULL")
      return originalBatch(statements)
    }
    await expect(publishBatch(f.db, "test", f.body, configs)).rejects.toThrow()
    expect(await f.db.prepare("SELECT COUNT(*) n FROM building_docs_v3").first("n")).toBe(0)
    expect(await f.db.prepare("SELECT COUNT(*) n FROM building_receipts_v3").first("n")).toBe(0)
  } finally {
    f.sqlite.close()
  }
})
it("does not accept cross-host or unapproved-column articles", async () => {
  const f = await setup()
  try {
    await f.approve()
    const configs = await publishedBuildingSourceOverrides(f.event)
    for (const change of [{ url: "https://other.example.com/article" }, { column: "未确认栏目" }]) {
      const item = normalizeBatchItem({ ...f.item, data: { ...f.article, ...change } })
      await expect(publishBatch(f.db, "test", { ...f.body, items: [item] }, configs)).rejects.toThrow("来源栏目")
    }
  } finally {
    f.sqlite.close()
  }
})

it("rejects old client scope when same-name column URL changed before server reads configuration", async () => {
  const f = await setup()
  try {
    await f.approve()
    const changed = await saveSourceDraft(f.event, "building", f.draft.config.id, { ...f.draft.config, endpoints: f.draft.config.endpoints.map(e => ({ ...e, url: "https://example.com/changed-news" })) }, "test@example.com", { draftHash: f.draft.hash, activeRevision: 1 })
    const at = Date.now()
    await saveSourceTest(f.event, "building", changed.config.id, changed.config, successfulSourceTest(changed.config), "test@example.com", { draftHash: changed.hash, activeRevision: 1 }, at)
    await publishSourceDraft(f.event, "building", changed.config.id, changed.hash, "test@example.com", 1, at)
    await expect(publishBatch(f.db, "test", f.body, await publishedBuildingSourceOverrides(f.event))).rejects.toMatchObject({ statusCode: 409 })
    expect(await f.db.prepare("SELECT COUNT(*) n FROM building_docs_v3").first("n")).toBe(0)
    expect(await f.db.prepare("SELECT COUNT(*) n FROM building_receipts_v3").first("n")).toBe(0)
  } finally {
    f.sqlite.close()
  }
})
