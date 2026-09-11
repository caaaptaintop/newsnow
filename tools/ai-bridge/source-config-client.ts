import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceSources } from "../../shared/official-sources"
import { applyIntelligenceSourceConfig, sourceCatalogRevision, sourceConfigCanPublish, sourceConfigPolicy, validateIntelligenceSourceConfig,
  type IntelligenceSourceConfig, type PublishedSourceConfigEnvelope } from "../../shared/source-config"

interface Catalog { configs: Map<string, IntelligenceSourceConfig>, revision?: string, origin: "remote" | "cache" | "seed" }
let catalogPromise: Promise<Catalog> | undefined
function configFile() { return process.env.CAPX_SOURCE_CONFIG_FILE || resolve(process.cwd(), ".data/mac-batch/source-config.json") }
export async function validateSourceEnvelope(value: unknown): Promise<PublishedSourceConfigEnvelope> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Source configuration schema invalid")
  const input = value as PublishedSourceConfigEnvelope
  const known = intelligenceSources.filter(source => source.topic === "building")
  if (input.schemaVersion !== 1 || input.topic !== "building" || !Array.isArray(input.sources) || input.sources.length > known.length
    || typeof input.revision !== "string" || !/^[a-f0-9]{64}$/.test(input.revision)
    || !Number.isSafeInteger(input.generatedAt) || input.generatedAt <= 0 || input.generatedAt > Date.now() + 300_000) throw new Error("Source configuration envelope invalid")
  const seen = new Set<string>()
  const sources = input.sources.map((value) => {
    const seed = value && known.find(source => source.id === value.id)
    if (!seed || seen.has(seed.id)) throw new Error("Unknown or duplicate source configuration")
    seen.add(seed.id)
    const config = validateIntelligenceSourceConfig(value, seed)
    if (!sourceConfigCanPublish(config)) throw new Error("Unpublishable source configuration")
    return config
  })
  if (await sourceCatalogRevision(sources) !== input.revision) throw new Error("Source configuration fingerprint mismatch")
  return { schemaVersion: 1, topic: "building", generatedAt: input.generatedAt, revision: input.revision, sources }
}
async function readLastKnownGood() {
  const file = configFile()
  if (!existsSync(file)) return undefined
  const bytes = readFileSync(file)
  if (bytes.byteLength > sourceConfigPolicy.maxResponseBytes) throw new Error("Last-known-good configuration is too large; preserved for inspection")
  // A corrupt managed cache is not permission to silently re-enable repository seeds.
  return validateSourceEnvelope(JSON.parse(bytes.toString("utf8")))
}
async function responseEnvelope(response: Response) {
  if (!response.ok || response.redirected || !/application\/json/i.test(response.headers.get("content-type") ?? "")) throw new Error("Source configuration response unavailable")
  if (!response.body || Number(response.headers.get("content-length")) > sourceConfigPolicy.maxResponseBytes) throw new Error("Source configuration response too large")
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let size = 0, json = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > sourceConfigPolicy.maxResponseBytes) { await reader.cancel(); throw new Error("Source configuration response too large") }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
  }
  finally { reader.releaseLock() }
  return validateSourceEnvelope(JSON.parse(json))
}
async function refresh(cachedOnly: boolean): Promise<Catalog> {
  const make = (envelope: PublishedSourceConfigEnvelope | undefined, origin: Catalog["origin"]): Catalog => ({
    configs: new Map((envelope?.sources ?? []).map(config => [config.id, config])), revision: envelope?.revision, origin,
  })
  if (cachedOnly || (process.env.NODE_ENV === "test" && !process.env.CAPX_SOURCE_CONFIG_URL)) {
    const cache = await readLastKnownGood()
    return make(cache, cache ? "cache" : "seed")
  }
  let envelope: PublishedSourceConfigEnvelope
  try {
    envelope = await responseEnvelope(await fetch(process.env.CAPX_SOURCE_CONFIG_URL || "https://news.capx-ai.com/api/intelligence/building/source-config", {
      signal: AbortSignal.timeout(15_000), redirect: "error", headers: { accept: "application/json" },
    }))
    // Removing an override is not a supported operation. A truncated catalog cannot revive disabled seeds.
    const cache = await readLastKnownGood().catch(() => undefined)
    if (cache && (envelope.generatedAt < cache.generatedAt || cache.sources.some(old => !envelope.sources.some(source => source.id === old.id)))) throw new Error("Incomplete or stale remote catalog")
  }
  catch {
    const cache = await readLastKnownGood()
    console.warn(cache ? "Source configuration unavailable; retaining validated last-known-good" : "Source configuration unavailable; using initial repository seeds")
    return make(cache, cache ? "cache" : "seed")
  }
  const file = configFile(), pending = `${file}.pending-${crypto.randomUUID()}`
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(pending, `${JSON.stringify(envelope)}\n`, { mode: 0o600, flag: "wx" })
    renameSync(pending, file)
  }
  catch {
    try { unlinkSync(pending) } catch { /* Only this invocation's temporary file is eligible for cleanup. */ }
    throw new Error("Cannot preserve published source configuration; collection stopped")
  }
  return make(envelope, "remote")
}
async function catalog(cachedOnly = false) {
  catalogPromise ??= refresh(cachedOnly)
  return catalogPromise
}
export async function resolvePublishedSource(source: IntelligenceSource, cachedOnly = false) {
  if (source.topic !== "building") return source
  const override = (await catalog(cachedOnly)).configs.get(source.id)
  return override ? applyIntelligenceSourceConfig(source, override) : source
}
export async function sourceConfigProvenance() {
  const { revision, origin } = await catalog()
  return { revision, origin }
}
export function resetPublishedSourceConfigForTests() { catalogPromise = undefined }
