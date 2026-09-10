import { BuildingError } from "../../shared/building-contract"
import { sourceEndpointKinds, type ManagedSourceConfig, type SourceCollectionMode } from "../../shared/source-config"

const topics = new Set(["building", "ai", "finance", "health"])
const modes = new Set<SourceCollectionMode>(["explicit", "legacy-discovery", "feed"])

function safePublicUrl(value: unknown, label: string) {
  if (typeof value !== "string" || value.length > 2048) throw new BuildingError(400, `${label}无效`)
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new BuildingError(400, `${label}无效`) }
  if (!/^https?:$/.test(url.protocol) || (url.port && !["80", "443"].includes(url.port))) throw new BuildingError(400, `${label}只允许HTTP或HTTPS标准端口`)
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new BuildingError(400, `${label}不得指向本机或IP地址`)
  }
  url.hash = ""
  return url.href
}

export function normalizeManagedSourceConfig(input: unknown): ManagedSourceConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BuildingError(400, "信息源配置无效")
  const value = input as Record<string, any>
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(id)) throw new BuildingError(400, "信息源编号无效")
  if (!topics.has(value.topic)) throw new BuildingError(400, "信息源主题无效")
  const text = (key: string, max: number, optional = false) => {
    const result = typeof value[key] === "string" ? value[key].trim() : ""
    if ((!optional && !result) || result.length > max) throw new BuildingError(400, `${key}无效`)
    return result
  }
  const home = safePublicUrl(value.home, "官网地址")
  const approvedHost = new URL(home).hostname.toLowerCase().replace(/^www\./, "")
  if (!modes.has(value.collectionMode)) throw new BuildingError(400, "采集模式无效")
  if (!Array.isArray(value.endpoints) || value.endpoints.length > 12) throw new BuildingError(400, "采集栏目数量无效")
  const endpointIds = new Set<string>()
  const endpointUrls = new Set<string>()
  const endpoints = value.endpoints.map((endpoint: any) => {
    if (!endpoint || typeof endpoint !== "object") throw new BuildingError(400, "采集栏目无效")
    const endpointId = typeof endpoint.id === "string" ? endpoint.id.trim() : ""
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(endpointId) || endpointIds.has(endpointId)) throw new BuildingError(400, "采集栏目编号重复或无效")
    endpointIds.add(endpointId)
    if (!sourceEndpointKinds.includes(endpoint.kind)) throw new BuildingError(400, "采集栏目类型无效")
    const name = typeof endpoint.name === "string" ? endpoint.name.trim() : ""
    if (!name || name.length > 80) throw new BuildingError(400, "采集栏目名称无效")
    const url = safePublicUrl(endpoint.url, "采集栏目地址")
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    if (host !== approvedHost) throw new BuildingError(400, "采集栏目必须与官网使用同一主机；跳转或换域名时请先更新官网")
    const canonical = new URL(url)
    canonical.searchParams.sort()
    const urlKey = canonical.href
    if (endpointUrls.has(urlKey)) throw new BuildingError(400, "采集栏目地址重复")
    endpointUrls.add(urlKey)
    return { id: endpointId, kind: endpoint.kind, name, url, enabled: endpoint.enabled !== false }
  })
  const collectionMode = value.collectionMode as SourceCollectionMode
  const newsnowId = typeof value.newsnowId === "string" ? value.newsnowId.trim() : undefined
  if (collectionMode === "feed" && !newsnowId) throw new BuildingError(400, "平台信息源缺少适配器编号")
  if (collectionMode === "explicit" && !endpoints.some(endpoint => endpoint.enabled)) throw new BuildingError(400, "明确栏目模式至少需要一个启用栏目")
  const priority = Number(value.priority)
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1000) throw new BuildingError(400, "优先级无效")
  return {
    id,
    topic: value.topic,
    name: text("name", 160),
    home,
    group: text("group", 80),
    level: text("level", 40),
    region: text("region", 40, true),
    city: text("city", 40, true),
    priority,
    enabled: value.enabled !== false,
    collectionMode,
    endpoints,
    ...(newsnowId ? { newsnowId } : {}),
  }
}

export function parseStoredConfig(value: unknown) {
  try { return normalizeManagedSourceConfig(typeof value === "string" ? JSON.parse(value) : value) }
  catch { return undefined }
}
