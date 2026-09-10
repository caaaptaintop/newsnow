import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { IntelligenceSource } from "../../shared/intelligence"
import { applyIntelligenceSourceConfig, type IntelligenceSourceConfig, type PublishedSourceConfigEnvelope } from "../../shared/source-config"

let catalogPromise: Promise<Map<string, IntelligenceSourceConfig>> | undefined

function configFile() {
  return process.env.CAPX_SOURCE_CONFIG_FILE || resolve(process.cwd(), ".data/mac-batch/source-config.json")
}

function validateEnvelope(value: unknown): PublishedSourceConfigEnvelope {
  if (!value || typeof value !== "object") throw new Error("source config response is not an object")
  const envelope = value as PublishedSourceConfigEnvelope
  if (envelope.schemaVersion !== 1 || envelope.topic !== "building" || !Array.isArray(envelope.sources)) throw new Error("source config response schema is invalid")
  for (const source of envelope.sources) {
    if (!source || source.schemaVersion !== 1 || source.topic !== "building" || typeof source.id !== "string" || !Array.isArray(source.endpoints)) {
      throw new Error("source config entry is invalid")
    }
  }
  return envelope
}

function readLastKnownGood() {
  const file = configFile()
  if (!existsSync(file)) return undefined
  try {
    return validateEnvelope(JSON.parse(readFileSync(file, "utf8")))
  }
  catch {
    return undefined
  }
}

async function refresh() {
  if (process.env.NODE_ENV === "test" && !process.env.CAPX_SOURCE_CONFIG_URL) return readLastKnownGood()
  const url = process.env.CAPX_SOURCE_CONFIG_URL || "https://news.capx-ai.com/api/intelligence/building/source-config"
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const envelope = validateEnvelope(await response.json())
    const file = configFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.pending`, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 })
    renameSync(`${file}.pending`, file)
    return envelope
  }
  catch (error) {
    const cached = readLastKnownGood()
    if (cached) return cached
    console.warn(`Published source config unavailable; using repository seeds (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
}

async function catalog() {
  catalogPromise ??= refresh().then(envelope => new Map((envelope?.sources ?? []).map(source => [source.id, source])))
  return catalogPromise
}

export async function resolvePublishedSource(source: IntelligenceSource) {
  if (source.topic !== "building") return source
  const override = (await catalog()).get(source.id)
  return override ? applyIntelligenceSourceConfig(source, override) : source
}

export function resetPublishedSourceConfigForTests() {
  catalogPromise = undefined
}
