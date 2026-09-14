import { expect, it } from "vitest"
import { createSourceDraft, publishSourceDraft, publishedBuildingSourceOverrides, registeredSourceSeed, saveSourceDraft, saveSourceTest, sourceAdminModel } from "../server/utils/source-config-store"
import { customSourceSeed, sourceConfigEnvelope } from "../shared/source-config"
import { validateSourceEnvelope } from "../tools/ai-bridge/source-config-client"
import { memorySourceDatabase, successfulSourceTest } from "./fixtures/source-admin-contract-cases"

it("registers a disabled custom draft, then requires tested confirmation for the catalog", async () => {
  const f = memorySourceDatabase()
  try {
    const created = await createSourceDraft(f.event, { name: "新增测试来源", home: "https://example.com", enabled: true, collectionApproved: true }, "admin@example.com")
    expect(created.config.enabled).toBe(false)
    expect(created.config.id).toMatch(/^custom-/)
    expect(await publishedBuildingSourceOverrides(f.event)).toEqual([])
    expect((await sourceAdminModel(f.event, "building")).sources.find(s => s.id === created.config.id)?.collectionEnabled).toBe(false)
    const draft = await saveSourceDraft(f.event, "building", created.config.id, { ...created.config, enabled: true, endpoints: [{ id: "news", name: "建设动态", kind: "news", url: "https://example.com/news", enabled: true }] }, "admin@example.com", { draftHash: created.hash, activeRevision: 0 })
    const at = Date.now()
    await expect(publishSourceDraft(f.event, "building", draft.config.id, draft.hash, "admin@example.com", 0, at)).rejects.toThrow()
    await saveSourceTest(f.event, "building", draft.config.id, draft.config, successfulSourceTest(draft.config), "admin@example.com", { draftHash: draft.hash, activeRevision: 0 }, at)
    await publishSourceDraft(f.event, "building", draft.config.id, draft.hash, "admin@example.com", 0, at)
    const configs = await publishedBuildingSourceOverrides(f.event)
    expect(configs[0]).toMatchObject({ collectionApproved: true, enabled: true })
    expect((await validateSourceEnvelope(await sourceConfigEnvelope(configs))).sources[0].id).toBe(created.config.id)
    expect(customSourceSeed(configs[0])?.columns).toEqual([{ name: "建设动态", url: "https://example.com/news" }])
    await expect(saveSourceDraft(f.event, "building", created.config.id, { ...draft.config, home: "https://different.example.com" }, "admin@example.com", { draftHash: draft.hash, activeRevision: 1 })).rejects.toThrow()
  } finally {
    f.sqlite.close()
  }
})
it("rejects private hosts and unregistered IDs", async () => {
  const f = memorySourceDatabase()
  try {
    for (const home of ["http://127.0.0.1/", "http://localhost/", "http://192.168.1.1/", "https://user:pass@example.com/"]) {
      await expect(createSourceDraft(f.event, { name: "拒绝", home }, "admin@example.com")).rejects.toThrow()
    }
    await expect(registeredSourceSeed(f.event, "building", `custom-${crypto.randomUUID()}`)).rejects.toThrow()
  } finally {
    f.sqlite.close()
  }
})
