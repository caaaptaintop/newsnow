import type { IntelligenceSource } from "./intelligence"

export type IntelligenceEndpointKind = "policy" | "notice" | "interpretation" | "news" | "standard" | "other"
export type IntelligenceCollectionMode = "discover" | "explicit" | "feed"

export interface IntelligenceSourceEndpoint {
  id: string
  kind: IntelligenceEndpointKind
  name: string
  url: string
  enabled: boolean
}

export interface IntelligenceSourceConfig {
  schemaVersion: 1
  id: string
  topic: string
  name: string
  home: string
  group: string
  level: string
  region: string
  city: string
  priority: number
  enabled: boolean
  collectionMode: IntelligenceCollectionMode
  newsnowId?: string
  endpoints: IntelligenceSourceEndpoint[]
}

export interface PublishedSourceConfigEnvelope {
  schemaVersion: 1
  topic: "building"
  revision: number
  generatedAt: number
  sources: IntelligenceSourceConfig[]
}

const endpointKinds = new Set<IntelligenceEndpointKind>(["policy", "notice", "interpretation", "news", "standard", "other"])
const collectionModes = new Set<IntelligenceCollectionMode>(["discover", "explicit", "feed"])

export function intelligenceEndpointKind(name: string): IntelligenceEndpointKind {
  if (/政策解读|解读/.test(name)) return "interpretation"
  if (/标准|定额|规范/.test(name)) return "standard"
  if (/通知|公告|公示/.test(name)) return "notice"
  if (/政策|文件|规范性/.test(name)) return "policy"
  if (/动态|新闻|要闻/.test(name)) return "news"
  return "other"
}

function endpointId(sourceId: string, name: string, index: number) {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4E00-\u9FFF]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)
  return `${sourceId}:${slug || "endpoint"}:${index + 1}`
}

export function intelligenceSourceSeedConfig(source: IntelligenceSource): IntelligenceSourceConfig {
  const columns = source.columns ?? []
  return {
    schemaVersion: 1,
    id: source.id,
    topic: source.topic,
    name: source.name,
    home: source.home,
    group: source.group,
    level: source.level,
    region: source.region,
    city: source.city,
    priority: source.priority,
    enabled: source.enabled,
    collectionMode: source.newsnowId ? "feed" : columns.length ? "explicit" : "discover",
    newsnowId: source.newsnowId,
    endpoints: columns.map((column, index) => ({
      id: endpointId(source.id, column.name, index),
      kind: intelligenceEndpointKind(column.name),
      name: column.name,
      url: column.url,
      enabled: true,
    })),
  }
}

function cleanText(value: unknown, field: string, max = 160) {
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`)
  const cleaned = value.replace(/\s+/g, " ").trim()
  if (!cleaned || cleaned.length > max) throw new Error(`${field} 长度无效`)
  return cleaned
}

function normalizedUrl(value: unknown, field: string) {
  const raw = cleanText(value, field, 2048)
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error(`${field} 不是有效 URL`)
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error(`${field} 必须是无凭据的 HTTP/HTTPS 标准端口地址`)
  }
  url.hash = ""
  return url.href
}

function normalizedHost(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "")
}

export function validateIntelligenceSourceConfig(value: unknown, seed: IntelligenceSource): IntelligenceSourceConfig {
  if (!value || typeof value !== "object") throw new Error("来源配置必须是对象")
  const input = value as Record<string, unknown>
  if (input.id !== seed.id || input.topic !== seed.topic) throw new Error("来源 ID 和主题不可修改")
  const home = normalizedUrl(input.home, "官网地址")
  const homeHost = normalizedHost(home)
  if (seed.id.startsWith("official-") && !homeHost.endsWith(".gov.cn")) throw new Error("官方来源官网必须使用 .gov.cn 域名")
  const mode = input.collectionMode
  if (typeof mode !== "string" || !collectionModes.has(mode as IntelligenceCollectionMode)) throw new Error("采集模式无效")
  const rawEndpoints = Array.isArray(input.endpoints) ? input.endpoints : []
  if (rawEndpoints.length > 12) throw new Error("单个来源最多配置 12 个栏目")
  if (mode === "explicit" && !rawEndpoints.length) throw new Error("明确栏目模式至少需要一个栏目")
  const seenIds = new Set<string>()
  const endpoints = rawEndpoints.map((raw, index): IntelligenceSourceEndpoint => {
    if (!raw || typeof raw !== "object") throw new Error(`第 ${index + 1} 个栏目无效`)
    const endpoint = raw as Record<string, unknown>
    const id = cleanText(endpoint.id ?? endpointId(seed.id, String(endpoint.name ?? ""), index), "栏目 ID", 96)
    if (seenIds.has(id)) throw new Error("栏目 ID 不可重复")
    seenIds.add(id)
    const kind = endpoint.kind
    if (typeof kind !== "string" || !endpointKinds.has(kind as IntelligenceEndpointKind)) throw new Error("栏目类型无效")
    const url = normalizedUrl(endpoint.url, "栏目地址")
    if (normalizedHost(url) !== homeHost) throw new Error("栏目地址必须与官网使用同一主机")
    return {
      id,
      kind: kind as IntelligenceEndpointKind,
      name: cleanText(endpoint.name, "栏目名称", 80),
      url,
      enabled: endpoint.enabled !== false,
    }
  })
  if (mode === "explicit" && !endpoints.some(endpoint => endpoint.enabled)) throw new Error("明确栏目模式至少需要一个启用栏目")
  return {
    schemaVersion: 1,
    id: seed.id,
    topic: seed.topic,
    name: cleanText(input.name, "来源名称"),
    home,
    group: cleanText(input.group, "来源分组", 80),
    level: cleanText(input.level, "来源层级", 40),
    region: typeof input.region === "string" ? input.region.trim().slice(0, 40) : "",
    city: typeof input.city === "string" ? input.city.trim().slice(0, 40) : "",
    priority: Math.max(0, Math.min(1000, Math.trunc(Number(input.priority) || 0))),
    enabled: input.enabled !== false,
    collectionMode: mode as IntelligenceCollectionMode,
    newsnowId: seed.newsnowId,
    endpoints,
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]))
  }
  return value
}

export function intelligenceSourceConfigJson(config: IntelligenceSourceConfig) {
  return JSON.stringify(stable(config))
}

export async function intelligenceSourceConfigHash(config: IntelligenceSourceConfig) {
  const bytes = new TextEncoder().encode(intelligenceSourceConfigJson(config))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export function applyIntelligenceSourceConfig(seed: IntelligenceSource, config: IntelligenceSourceConfig): IntelligenceSource & { collectionMode: IntelligenceCollectionMode } {
  return {
    ...seed,
    name: config.name,
    home: config.home,
    group: config.group,
    level: config.level,
    region: config.region,
    city: config.city,
    priority: config.priority,
    enabled: config.enabled,
    columns: config.endpoints.filter(endpoint => endpoint.enabled).map(endpoint => ({ name: endpoint.name, url: endpoint.url })),
    collectionMode: config.collectionMode,
  }
}
