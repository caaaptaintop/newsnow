import { expect, it } from "vitest"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"
import { collectionItemAllowed, collectionScopeKey, collectionSourceAllowed, scopedPublicationBatch } from "../tools/ai-bridge/collection-scope"
import { runPendingSourceTests, runtimeTestAllowed } from "../tools/ai-bridge/source-test-runner"

const source = { ...intelligenceSources.find(s => s.id === "official-beijing")!, columns: [{ name: "通知公告", url: "https://zjw.beijing.gov.cn/notices/" }] }
it("only the resolved enabled catalog controls the collection scope", () => {
  expect(collectionSourceAllowed(source.id)).toBe(false)
  expect(collectionSourceAllowed(source.id, [source])).toBe(true)
  expect(collectionSourceAllowed(source.id, [{ ...source, enabled: false }])).toBe(false)
  expect(collectionItemAllowed({ sourceId: source.id, column: "通知公告" }, [source])).toBe(true)
  expect(collectionItemAllowed({ sourceId: source.id, column: "其他栏目" }, [source])).toBe(false)
})
it("old results cannot publish excluded sources or stale configuration candidates", () => {
  const other = { key: "old", sourceId: "official-shanghai", column: "通知公告" }
  const valid = { key: "new", sourceId: source.id, column: "通知公告", collectionScope: collectionScopeKey(source) }
  const stale = { ...valid, key: "stale", collectionScope: "old-config" }
  const snapshot = { articles: [other] }
  const batch = { articles: [other, valid, stale], decisions: [other, valid], states: [{ id: other.sourceId }, { id: valid.sourceId }], attachmentUpdates: [{ key: "old", attachments: [] }] }
  const result = scopedPublicationBatch(snapshot, batch, [source])
  expect(result.articles).toEqual([valid])
  expect(result.decisions).toEqual([valid])
  expect(result.attachmentUpdates).toEqual([])
  expect(snapshot.articles).toEqual([other])
  expect(batch.articles).toHaveLength(3)
  expect(() => scopedPublicationBatch(snapshot, { ...batch, attachmentUpdates: [{ key: "missing" }] }, [source])).toThrow()
})
it("administrator-requested valid draft tests can run before source enablement", async () => {
  const config = intelligenceSourceSeedConfig(source)
  const good = { sourceId: source.id, topic: "building", config, hash: "a".repeat(64), activeRevision: 0, requestedAt: Date.now() }
  const bad = [{ ...good, sourceId: "unknown" }, { ...good, config: { ...config, home: "http://127.0.0.1/" } }]
  let tested = 0
  await runPendingSourceTests({ limit: 4, allowed: runtimeTestAllowed, request: async (request: any) => request.action === "source-tests" ? { jobs: [...bad, good] } : {}, tester: async () => {
    tested++
    return {} as any
  } })
  expect(tested).toBe(1)
})
