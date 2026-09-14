import { getRequestURL, setHeader } from "h3"
import { buildingHash } from "../../shared/building-contract"
import { publishedBuildingSourceOverrides } from "../utils/source-config-store"
import { intelligenceSources } from "../../shared/official-sources"
import { applyIntelligenceSourceConfig, customSourceSeed, sourceCatalogRevision } from "../../shared/source-config"
import { readPage, readQuery, readVersion } from "./read"
import { buildingDB, buildingMeta } from "./store"

interface EdgeCache {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}
const entries = new Map<string, { expires: number, value: Promise<any> }>()
export async function cachedBuildingPage(event: any) {
  const db = buildingDB(event)
  const params = getRequestURL(event).searchParams
  const q = readQuery(params)
  const state = await buildingMeta(db)
  const configs = await publishedBuildingSourceOverrides(event)
  const catalog = [...intelligenceSources]
  for (const config of configs) {
    const index = catalog.findIndex(source => source.id === config.id)
    const seed = index >= 0 ? catalog[index] : customSourceSeed(config)
    if (!seed) continue
    const source = applyIntelligenceSourceConfig(seed, config)
    if (index >= 0) catalog[index] = source
    else catalog.push(source)
  }
  const key = await buildingHash(JSON.stringify(["building-v3.2", state.revision, q, await sourceCatalogRevision(configs)]))
  const previous = entries.get(key)
  if (previous && previous.expires > Date.now()) {
    setHeader(event, "X-Intelligence-Cache", "memory")
    return previous.value
  }
  const cache = (globalThis as typeof globalThis & { caches?: { default: EdgeCache } }).caches?.default
  const cacheKey = new Request(`${getRequestURL(event).origin}/__building_cache/${key}`)
  if (cache && !q.filters.q) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) {
        setHeader(event, "X-Intelligence-Cache", "edge")
        return await hit.json()
      }
    } catch { /* Cache is disposable. */ }
  }
  const pending = readPage(db, params, Date.now(), catalog)
  entries.set(key, { expires: Date.now() + 60000, value: pending })
  while (entries.size > 64)entries.delete(entries.keys().next().value!)
  try {
    const page = await pending
    setHeader(event, "X-Intelligence-Cache", "miss")
    if (cache && !q.filters.q) {
      const work = cache.put(cacheKey, new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } })).catch(() => {})
      const ctx = event.context.cloudflare?.context
      if (ctx?.waitUntil)ctx.waitUntil(work)
      else await work
    }
    return page
  } catch (error) {
    entries.delete(key)
    throw error
  }
}
export async function currentBuildingVersion(event: any) {
  return readVersion(buildingDB(event))
}
