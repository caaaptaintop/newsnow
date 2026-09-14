import { afterEach, expect, it, vi } from "vitest"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig, sourceConfigEnvelope } from "../shared/source-config"
import { sourceCollectionApproved } from "../shared/source-collection-approval"
import { resetPublishedSourceConfigForTests, resolveCollectionSource } from "../tools/ai-bridge/source-config-client"
import { publishSourceDraft, publishedBuildingSourceOverrides, saveSourceDraft, saveSourceTest } from "../server/utils/source-config-store"
import { memorySourceDatabase, successfulSourceTest, syntheticSourceConfig } from "./fixtures/source-admin-contract-cases"

const seed = intelligenceSources.find(s => s.id === "official-beijing")!
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetPublishedSourceConfigForTests()
})
it("draft/test alone never enables collection; explicit tested publication does", async () => {
  const f = memorySourceDatabase()
  try {
    const draft = await saveSourceDraft(f.event, "building", seed.id, { ...syntheticSourceConfig(), collectionApproved: true }, "admin@example.com", { draftHash: null, activeRevision: 0 })
    expect((draft.config as any).collectionApproved).toBeUndefined()
    expect(await publishedBuildingSourceOverrides(f.event)).toEqual([])
    const testedAt = Date.now()
    await saveSourceTest(f.event, "building", seed.id, draft.config, successfulSourceTest(draft.config), "admin@example.com", { draftHash: draft.hash, activeRevision: 0 }, testedAt)
    expect(await publishedBuildingSourceOverrides(f.event)).toEqual([])
    await publishSourceDraft(f.event, "building", seed.id, draft.hash, "admin@example.com", 0, testedAt)
    const configs = await publishedBuildingSourceOverrides(f.event)
    expect(configs[0]).toMatchObject({ collectionApproved: true, enabled: true })
    f.sqlite.exec("UPDATE intelligence_source_config_revision SET reason='publish'")
    expect((await publishedBuildingSourceOverrides(f.event))[0].collectionApproved).toBe(false)
  } finally {
    f.sqlite.close()
  }
})
it("collection is closed for seeds and old or disabled catalogs", async () => {
  vi.stubEnv("CAPX_SOURCE_CONFIG_URL", "https://example.test/config")
  vi.stubEnv("CAPX_SOURCE_CONFIG_FILE", `/private/tmp/newsnow-approval-${crypto.randomUUID()}/config.json`)
  const config = { ...intelligenceSourceSeedConfig(seed), collectionMode: "explicit" as const, endpoints: syntheticSourceConfig().endpoints }
  for (const sources of [[], [config], [{ ...config, collectionApproved: false }], [{ ...config, collectionApproved: true, enabled: false }], [{ ...config, collectionApproved: true }]]) {
    resetPublishedSourceConfigForTests()
    vi.stubEnv("CAPX_SOURCE_CONFIG_FILE", `/private/tmp/newsnow-approval-${crypto.randomUUID()}/config.json`)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(await sourceConfigEnvelope(sources)))
    expect((await resolveCollectionSource(seed)).enabled).toBe(sources[0]?.collectionApproved === true && sources[0]?.enabled === true)
  }
})
it("old non-ministry publications are not inherited as approvals", () => {
  expect(sourceCollectionApproved(syntheticSourceConfig(), "publish")).toBe(false)
  expect(sourceCollectionApproved(syntheticSourceConfig(), "collection-confirmed")).toBe(true)
})
