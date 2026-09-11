import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { H3Event } from "h3"
import { describe, expect, it } from "vitest"
import { publicApiAllowed } from "../shared/public-site"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"
import { publishedBuildingSourceOverrides, sourceAdminModel } from "../server/utils/source-config-store"

const configTables = ["intelligence_source_config_entry", "intelligence_source_config_revision"]

/** Scripted D1 transport fixture; JSON row shape matches building_sources_v3. */
function fixture(options: {
  tables?: string[]
  states?: Record<string, unknown>[]
  configs?: Record<string, unknown>[]
  fail?: boolean
} = {}) {
  const calls: string[] = []
  const db = {
    prepare(sql: string) {
      calls.push(sql)
      return {
        bind() { return this },
        async all() {
          if (options.fail) throw new Error("D1 unavailable")
          if (sql.includes("sqlite_master")) return { results: (options.tables ?? configTables).map(name => ({ name })) }
          if (sql.includes("FROM building_sources_v3")) return { results: options.states ?? [] }
          if (sql.includes("FROM building_source_states")) throw new Error("no such table: building_source_states")
          if (sql.includes("JOIN intelligence_source_config_revision")) return { results: options.configs ?? [] }
          if (sql.startsWith("SELECT")) return { results: [] }
          throw new Error(`Unexpected fixture query: ${sql}`)
        },
        async run() { return { meta: { changes: 1 } } },
      }
    },
    async batch() { return [] },
  }
  return { event: { context: { env: { NEWSNOW_DB: db } } } as unknown as H3Event, calls }
}

describe("source administration integration boundaries", () => {
  it.each(["GET", "HEAD"])("allows exactly the public source configuration %s route", (method) => {
    expect(publicApiAllowed("/api/intelligence/building/source-config", method)).toBe(true)
  })

  it.each([
    ["/api/intelligence/building/source-config", "POST"],
    ["/api/intelligence/building/source-config/extra", "GET"],
    ["/api/intelligence/ai/source-config", "GET"],
    ["/internal/api/sources", "GET"],
    ["/api/intelligence/ai/status", "GET"],
  ])("does not widen the public gate to %s %s", (path, method) => {
    expect(publicApiAllowed(path, method)).toBe(false)
  })

  it("routes internal pages and APIs to Workers in the actual build finalizer", () => {
    const directory = mkdtempSync(join(tmpdir(), "source-admin-build-"))
    try {
      mkdirSync(join(directory, "data"))
      mkdirSync(join(directory, "dist/output/public"), { recursive: true })
      writeFileSync(join(directory, "data/intelligence-snapshot.json"), '{"articles":[]}')
      writeFileSync(join(directory, "dist/output/public/index.html"), "<!doctype html><title>Synthetic fixture</title>")
      execFileSync(process.execPath, [resolve("scripts/finalize-public-build.mjs")], {
        cwd: directory,
        env: { ...process.env, CF_PAGES: "1" },
        encoding: "utf8",
        timeout: 10_000,
      })
      const routes = JSON.parse(readFileSync(join(directory, "dist/output/public/_routes.json"), "utf8"))
      expect(routes.include).toEqual(["/api", "/api/*", "/internal", "/internal/*"])
      expect(routes.exclude).toEqual([])
      expect(routes.include).not.toContain("/*")
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("reads health from the existing v3 table and decodes its JSON data", async () => {
    const { event, calls } = fixture({ states: [{
      id: "official-beijing",
      checked_at: 1789040100000,
      data: JSON.stringify({ status: "partial", checkedAt: 1789040100000, fetched: 17, accepted: 2 }),
    }] })
    const model = await sourceAdminModel(event, "building")
    const source = model.sources.find(item => item.id === "official-beijing")!
    expect(source.runtime).toMatchObject({ status: "partial", updatedAt: 1789040100000, candidateCount: 17, acceptedCount: 2 })
    expect(source.runtime.message).toContain("未包含失败详情")
    expect(calls.some(sql => sql.includes("FROM building_source_states"))).toBe(false)
  })

  it("distinguishes a corrupt health row from a source with no history", async () => {
    const { event } = fixture({ states: [{ id: "official-beijing", checked_at: 1789040100000, data: "{broken" }] })
    const model = await sourceAdminModel(event, "building")
    expect(model.sources.find(item => item.id === "official-beijing")?.runtime).toMatchObject({
      status: "unknown",
      message: "来源运行记录损坏或状态无效",
    })
    expect(model.sources.find(item => item.id === "official-mohurd")?.runtime.message).toBe("尚无运行记录")
  })

  it("does not pretend an unavailable D1 binding is an empty published catalog", async () => {
    await expect(publishedBuildingSourceOverrides({ context: { env: {} } } as H3Event)).rejects.toMatchObject({ statusCode: 503 })
  })

  it("returns an error on D1 failure so the Mac client can retain LKG", async () => {
    await expect(publishedBuildingSourceOverrides(fixture({ fail: true }).event)).rejects.toMatchObject({ statusCode: 503 })
  })

  it("allows initial seeds only after confirming no configuration tables, without DDL", async () => {
    const { event, calls } = fixture({ tables: [] })
    await expect(publishedBuildingSourceOverrides(event)).resolves.toEqual([])
    expect(calls.some(sql => sql.includes("sqlite_master"))).toBe(true)
    expect(calls.every(sql => !/\b(?:CREATE|INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true)
  })

  it("does not treat a partial schema as an empty catalog", async () => {
    await expect(publishedBuildingSourceOverrides(fixture({ tables: [configTables[0]] }).event)).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(["{broken", "null", '{"id":"unknown"}', null])("rejects invalid active config %s rather than dropping it", async (configJson) => {
    const { event } = fixture({ configs: [{ source_id: "official-beijing", config_json: configJson }] })
    await expect(publishedBuildingSourceOverrides(event)).rejects.toMatchObject({ statusCode: 503 })
  })

  it("returns only validated public configuration fields, including disabled sources", async () => {
    const seed = intelligenceSources.find(source => source.id === "official-beijing")!
    const config = { ...intelligenceSourceSeedConfig(seed), enabled: false, extraAuditField: "must-not-leak" }
    const { event } = fixture({ configs: [{ source_id: seed.id, config_json: JSON.stringify(config) }] })
    const configs = await publishedBuildingSourceOverrides(event)
    expect(configs).toHaveLength(1)
    expect(configs[0].enabled).toBe(false)
    expect(configs[0]).not.toHaveProperty("extraAuditField")
  })
})
