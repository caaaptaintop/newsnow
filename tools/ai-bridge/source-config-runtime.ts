import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { intelligenceSources as seedSources } from "../../shared/official-sources"
import { sourceConfigToIntelligenceSource, type SourceConfigSnapshot } from "../../shared/source-config"
import type { IntelligenceSource } from "../../shared/intelligence"

const cachePath = process.env.NEWSNOW_SOURCE_CONFIG_CACHE || join(process.cwd(), ".data/source-config/published.json")
const endpoint = process.env.NEWSNOW_SOURCE_CONFIG_URL || "https://news.capx-ai.com/api/intelligence/source-config?topic=building"
const testing = process.env.VITEST === "true" || process.env.NODE_ENV === "test"

function parseSnapshot(value: unknown): SourceConfigSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("信息源配置响应无效")
  const snapshot = value as SourceConfigSnapshot
  if (snapshot.schemaVersion !== 1 || snapshot.topic !== "building" || !Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.sources)) throw new Error("信息源配置版本无效")
  return snapshot
}

function asSources(snapshot: SourceConfigSnapshot): IntelligenceSource[] {
  return snapshot.sources.map(sourceConfigToIntelligenceSource)
}

export async function fetchRuntimeIntelligenceSources(): Promise<IntelligenceSource[]> {
  if (testing) return seedSources
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`信息源配置读取失败（HTTP ${response.status}）`)
    const snapshot = parseSnapshot(await response.json())
    mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 })
    const temporary = `${cachePath}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
    renameSync(temporary, cachePath)
    return asSources(snapshot)
  } catch (error) {
    try { return asSources(parseSnapshot(JSON.parse(readFileSync(cachePath, "utf8")))) }
    catch { throw error }
  }
}

export function readCachedRuntimeIntelligenceSources(): IntelligenceSource[] {
  if (testing) return seedSources
  try { return asSources(parseSnapshot(JSON.parse(readFileSync(cachePath, "utf8")))) }
  catch { return seedSources }
}
