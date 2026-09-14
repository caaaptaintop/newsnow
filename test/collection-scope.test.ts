import { expect, it } from "vitest"
import type { IntelligenceSource } from "../shared/intelligence"
import { assertCollectionColumns, collectionColumns, collectionItemAllowed, collectionSourceAllowed, scopedPublicationBatch } from "../tools/ai-bridge/collection-scope"
import { runPendingSourceTests, runtimeTestAllowed } from "../tools/ai-bridge/source-test-runner"

const source = { id: "official-mohurd", columns: [...collectionColumns].map(([name, url]) => ({ name, url })) } as IntelligenceSource
it("allows only the four verified ministry columns", () => {
  expect(() => assertCollectionColumns(source)).not.toThrow()
  expect(collectionSourceAllowed("official-shanghai")).toBe(false)
  expect(collectionItemAllowed({ sourceId: source.id, column: "建设要闻" })).toBe(true)
  expect(collectionItemAllowed({ sourceId: source.id, column: "其他栏目" })).toBe(false)
  expect(collectionItemAllowed({ sourceId: "official-shanghai", column: "建设要闻" })).toBe(false)
})

it("old results cannot republish other sources or change their attachments", () => {
  const other = { key: "old", sourceId: "official-shanghai", column: "建设要闻" }
  const valid = { key: "new", sourceId: "official-mohurd", column: "建设要闻" }
  const snapshot = { articles: [other] }
  const batch = { articles: [other, valid], decisions: [other, valid], states: [{ id: other.sourceId }, { id: valid.sourceId }], attachmentUpdates: [{ key: "old", attachments: [] }] }
  const result = scopedPublicationBatch(snapshot, batch)
  expect(result.articles).toEqual([valid])
  expect(result.decisions).toEqual([valid])
  expect(result.states).toEqual([{ id: valid.sourceId }])
  expect(result.attachmentUpdates).toEqual([])
  expect(batch.articles).toHaveLength(2)
  expect(snapshot.articles).toEqual([other])
  expect(() => scopedPublicationBatch(snapshot, { ...batch, attachmentUpdates: [{ key: "missing" }] })).toThrow()
})

it("automatic source testing leaves unauthorized jobs untouched", async () => {
  const config = { id: source.id, home: "https://www.mohurd.gov.cn/", collectionMode: "explicit", endpoints: source.columns!.map(c => ({ ...c, enabled: true })) }
  const good: any = { sourceId: source.id, config }
  expect(runtimeTestAllowed(good)).toBe(true)
  const bad = [{ ...good, sourceId: "official-shanghai" }, { ...good, config: { ...config, endpoints: [...config.endpoints, { name: "新栏目", url: "https://www.mohurd.gov.cn/new", enabled: true }] } }]
  let tested = 0
  let saved = 0
  await runPendingSourceTests({ limit: 4, allowed: runtimeTestAllowed, request: async (request: any) => {
    if (request.action === "source-tests") return { jobs: [...bad, good] }
    saved++
    return {}
  }, tester: async () => {
    tested++
    return {} as any
  } })
  expect(tested).toBe(1)
  expect(saved).toBe(1)
})
it("stops on missing, added, duplicate or changed columns before collection", () => {
  for (const columns of [[], source.columns!.slice(1), [...source.columns!, source.columns![0]], source.columns!.map(() => source.columns![0]), source.columns!.map(c => ({ ...c, url: `${c.url}?changed=1` }))]) {
    expect(() => assertCollectionColumns({ ...source, columns })).toThrow("住建部四栏目")
  }
  expect(() => assertCollectionColumns({ ...source, id: "official-shanghai" })).toThrow()
})
