import type { IntelligenceSource } from "./intelligence"
import { publicAttachmentUrl } from "./attachment-preview"

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
  /** SHA-256 of the ordered, validated catalog. Not its row count. */
  revision: string
  generatedAt: number
  sources: IntelligenceSourceConfig[]
}
export interface SourceDraftBase {
  draftHash: string | null
  activeRevision: number
}
export const sourceConfigPolicy = Object.freeze({ maxEndpoints: 12, testMaxAgeMs: 60 * 60 * 1000, maxResponseBytes: 256 * 1024, maxRequestBytes: 48 * 1024 })
const endpointKinds = new Set<IntelligenceEndpointKind>(["policy", "notice", "interpretation", "news", "standard", "other"])
const collectionModes = new Set<IntelligenceCollectionMode>(["discover", "explicit", "feed"])

export function intelligenceEndpointKind(name: string): IntelligenceEndpointKind {
  if (/政策解读|解读/.test(name)) return "interpretation"
  if (/政策|文件|规范性/.test(name)) return "policy"
  if (/标准|定额|规范/.test(name)) return "standard"
  if (/通知|公告|公示/.test(name)) return "notice"
  if (/动态|新闻|要闻/.test(name)) return "news"
  return "other"
}
function endpointId(sourceId: string, name: string, index: number) {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4E00-\u9FFF]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)
  return `${sourceId}:${slug || "endpoint"}:${index + 1}`
}
export function intelligenceSourceSeedConfig(source: IntelligenceSource): IntelligenceSourceConfig {
  return {
    schemaVersion: 1, id: source.id, topic: source.topic, name: source.name, home: source.home,
    group: source.group, level: source.level, region: source.region, city: source.city,
    priority: source.priority, enabled: source.enabled,
    collectionMode: source.newsnowId ? "feed" : source.columns?.length ? "explicit" : "discover",
    ...(source.newsnowId ? { newsnowId: source.newsnowId } : {}),
    endpoints: (source.columns ?? []).map((column, index) => ({
      id: endpointId(source.id, column.name, index), kind: intelligenceEndpointKind(column.name),
      name: column.name, url: column.url, enabled: true,
    })),
  }
}
function text(value: unknown, field: string, max = 160, optional = false) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} 必须是无控制字符的文本`)
  const cleaned = value.replace(/\s+/g, " ").trim()
  if ((!optional && !cleaned) || cleaned.length > max) throw new Error(`${field} 长度无效`)
  return cleaned
}
function normalizedUrl(value: unknown, field: string) {
  const raw = text(value, field, 2048)
  try { return publicAttachmentUrl(raw) }
  catch { throw new Error(`${field} 必须是公网、无凭据、无非默认端口的 HTTP/HTTPS 地址`) }
}
export function sourceConfigHost(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "")
}
export function validateSourceDraftBase(value: unknown): SourceDraftBase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("缺少当前草稿和发布版本基线，请刷新")
  const base = value as SourceDraftBase
  if (!(base.draftHash === null || (typeof base.draftHash === "string" && /^[a-f0-9]{64}$/.test(base.draftHash)))
    || !Number.isSafeInteger(base.activeRevision) || base.activeRevision < 0) throw new Error("配置版本基线无效")
  return { draftHash: base.draftHash, activeRevision: base.activeRevision }
}
export function validateIntelligenceSourceConfig(value: unknown, seed: IntelligenceSource): IntelligenceSourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("来源配置必须是对象")
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== 1 || input.id !== seed.id || input.topic !== seed.topic) throw new Error("来源 ID、主题和配置格式不可修改")
  const home = normalizedUrl(input.home, "官网地址")
  const homeHost = sourceConfigHost(home)
  if (seed.id.startsWith("official-") && !homeHost.endsWith(".gov.cn")) throw new Error("官方来源官网必须使用 .gov.cn 域名")
  // Non-official seeds use registered readers, not arbitrary administrator-supplied fetch hosts.
  if (!seed.id.startsWith("official-") && homeHost !== sourceConfigHost(seed.home)) throw new Error("结构化来源不可改变已注册读取器的主机")
  const mode = input.collectionMode
  if (typeof mode !== "string" || !collectionModes.has(mode as IntelligenceCollectionMode)) throw new Error("采集模式无效")
  if ((mode === "feed") !== !!seed.newsnowId) throw new Error("采集模式与已注册读取器不兼容")
  if (input.newsnowId !== undefined && input.newsnowId !== seed.newsnowId) throw new Error("不可更换已注册读取器")
  if (typeof input.enabled !== "boolean") throw new Error("启用状态必须是布尔值")
  if (!Number.isSafeInteger(input.priority) || Number(input.priority) < 0 || Number(input.priority) > 1000) throw new Error("优先级须为 0–1000 的整数")
  if (!Array.isArray(input.endpoints) || input.endpoints.length > sourceConfigPolicy.maxEndpoints) throw new Error("单个来源最多配置 12 个栏目")
  const seenIds = new Set<string>(), seenUrls = new Set<string>()
  const endpoints = input.endpoints.map((raw, index): IntelligenceSourceEndpoint => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`第 ${index + 1} 个栏目无效`)
    const endpoint = raw as Record<string, unknown>
    const id = text(endpoint.id, "栏目 ID", 96)
    if (seenIds.has(id)) throw new Error("栏目 ID 不可重复")
    seenIds.add(id)
    const kind = endpoint.kind
    if (typeof kind !== "string" || !endpointKinds.has(kind as IntelligenceEndpointKind)) throw new Error("栏目类型无效")
    const url = normalizedUrl(endpoint.url, "栏目地址")
    if (sourceConfigHost(url) !== homeHost) throw new Error("栏目地址必须与官网使用同一主机")
    if (seenUrls.has(url)) throw new Error("栏目地址不可重复")
    seenUrls.add(url)
    if (typeof endpoint.enabled !== "boolean") throw new Error("栏目启用状态必须是布尔值")
    return { id, kind: kind as IntelligenceEndpointKind, name: text(endpoint.name, "栏目名称", 80), url, enabled: endpoint.enabled }
  })
  if (input.enabled && mode === "explicit" && !endpoints.some(endpoint => endpoint.enabled)) throw new Error("明确栏目模式至少需要一个启用栏目")
  if (mode === "feed" && endpoints.length) throw new Error("结构化读取器不使用网页栏目")
  return {
    schemaVersion: 1, id: seed.id, topic: seed.topic, name: text(input.name, "来源名称"), home,
    group: text(input.group, "来源分组", 80), level: text(input.level, "来源层级", 40),
    region: text(input.region, "地区", 40, true), city: text(input.city, "城市", 40, true),
    priority: Number(input.priority), enabled: input.enabled, collectionMode: mode as IntelligenceCollectionMode,
    ...(seed.newsnowId ? { newsnowId: seed.newsnowId } : {}), endpoints,
  }
}
export function sourceConfigCanPublish(config: IntelligenceSourceConfig) {
  return !config.enabled || config.collectionMode === "explicit" || (config.collectionMode === "feed" && !!config.newsnowId)
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]))
  return value
}
export function intelligenceSourceConfigJson(config: IntelligenceSourceConfig) { return JSON.stringify(stable(config)) }
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}
export function intelligenceSourceConfigHash(config: IntelligenceSourceConfig) { return digest(intelligenceSourceConfigJson(config)) }
export function sourceCatalogRevision(sources: IntelligenceSourceConfig[]) {
  const sorted = [...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return digest(JSON.stringify(stable(sorted)))
}
export async function sourceConfigEnvelope(sources: IntelligenceSourceConfig[]): Promise<PublishedSourceConfigEnvelope> {
  return { schemaVersion: 1, topic: "building", revision: await sourceCatalogRevision(sources), generatedAt: Date.now(), sources }
}
export function applyIntelligenceSourceConfig(seed: IntelligenceSource, config: IntelligenceSourceConfig): IntelligenceSource & { collectionMode: IntelligenceCollectionMode } {
  return { ...seed, name: config.name, home: config.home, group: config.group, level: config.level,
    region: config.region, city: config.city, priority: config.priority, enabled: config.enabled,
    columns: config.endpoints.filter(endpoint => endpoint.enabled).map(endpoint => ({ name: endpoint.name, url: endpoint.url })),
    collectionMode: config.collectionMode }
}
