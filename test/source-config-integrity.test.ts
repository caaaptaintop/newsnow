import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { intelligenceSourceSeedConfig, sourceConfigEnvelope } from "../shared/source-config"
import { officialIntelligenceSources } from "../shared/official-sources"
import { resetPublishedSourceConfigForTests, resolvePublishedSource, validateSourceEnvelope } from "../tools/ai-bridge/source-config-client"

describe("validated source catalog and last-known-good", () => {
  const seed = officialIntelligenceSources.find(s => s.id === "official-beijing")!
  const config = { ...intelligenceSourceSeedConfig(seed), enabled: false }
  const original = { file: process.env.CAPX_SOURCE_CONFIG_FILE, url: process.env.CAPX_SOURCE_CONFIG_URL }
  let directory: string | undefined
  afterEach(() => {
    vi.restoreAllMocks(); resetPublishedSourceConfigForTests()
    for (const [name, value] of [["CAPX_SOURCE_CONFIG_FILE", original.file], ["CAPX_SOURCE_CONFIG_URL", original.url]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value
    }
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
  async function cache() {
    directory = mkdtempSync(join(tmpdir(), "source-integrity-"))
    const path = join(directory, "config.json"), envelope = await sourceConfigEnvelope([config])
    process.env.CAPX_SOURCE_CONFIG_FILE = path
    process.env.CAPX_SOURCE_CONFIG_URL = "https://example.com/synthetic-config"
    writeFileSync(path, JSON.stringify(envelope))
    return { path, envelope, before: readFileSync(path, "utf8") }
  }
  it("rejects content tampering while the number of sources stays unchanged", async () => {
    const envelope = await sourceConfigEnvelope([config])
    envelope.sources[0] = { ...config, name: "tampered" }
    await expect(validateSourceEnvelope(envelope)).rejects.toThrow(/fingerprint/)
  })
  it("rejects duplicate registered IDs", async () => {
    await expect(validateSourceEnvelope(await sourceConfigEnvelope([config, config]))).rejects.toThrow(/duplicate/)
  })
  it("rejects an unknown ID even with a matching envelope digest", async () => {
    await expect(validateSourceEnvelope(await sourceConfigEnvelope([{ ...config, id: "unknown" }]))).rejects.toThrow(/Unknown/)
  })
  it.each([503, 403, 404])("retains disabled source and cache on remote HTTP %s", async (status) => {
    const f = await cache()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("failure", { status }))
    expect((await resolvePublishedSource(seed)).enabled).toBe(false)
    expect(readFileSync(f.path, "utf8")).toBe(f.before)
  })
  it("does not accept a truncated successful catalog that would revive a source", async () => {
    const f = await cache()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(await sourceConfigEnvelope([])))
    expect((await resolvePublishedSource(seed)).enabled).toBe(false)
    expect(readFileSync(f.path, "utf8")).toBe(f.before)
  })
  it("fails closed on corrupt cache plus unavailable remote rather than deleting cache", async () => {
    const f = await cache(); writeFileSync(f.path, "{broken")
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    await expect(resolvePublishedSource(seed)).rejects.toThrow()
    expect(readFileSync(f.path, "utf8")).toBe("{broken")
  })
  it("pins a validated remote config for the whole collection process", async () => {
    await cache()
    const next = { ...config, collectionMode: "explicit" as const, enabled: true,
      endpoints: [{ id: "notice", kind: "notice" as const, name: "合成栏目", url: `${seed.home}synthetic/`, enabled: true }] }
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(await sourceConfigEnvelope([next])))
    expect((await resolvePublishedSource(seed)).columns?.[0].url).toBe(next.endpoints[0].url)
    expect((await resolvePublishedSource(seed)).enabled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
