import type { IntelligenceSource, IntelligenceTopic } from "./intelligence"

export const sourceConfigSchemaVersion = 1
export const sourceEndpointKinds = ["policy", "notice", "interpretation", "news", "standard", "other"] as const
export type SourceEndpointKind = typeof sourceEndpointKinds[number]
export type SourceCollectionMode = "explicit" | "legacy-discovery" | "feed"

export interface SourceEndpointConfig {
  id: string
  kind: SourceEndpointKind
  name: string
  url: string
  enabled: boolean
}

export interface ManagedSourceConfig {
  id: string
  topic: IntelligenceTopic
  name: string
  home: string
  group: string
  level: string
  region: string
  city: string
  priority: number
  enabled: boolean
  collectionMode: SourceCollectionMode
  endpoints: SourceEndpointConfig[]
  newsnowId?: string
}

export interface SourceConfigSnapshot {
  schemaVersion: number
  revision: number
  generatedAt: number
  topic: IntelligenceTopic
  sources: ManagedSourceConfig[]
}

export function inferSourceEndpointKind(name: string): SourceEndpointKind {
  if (/政策解读|解读/.test(name)) return "interpretation"
  if (/标准|定额/.test(name)) return "standard"
  if (/通知|公告|公示/.test(name)) return "notice"
  if (/政策|规范性|文件/.test(name)) return "policy"
  if (/动态|要闻|新闻/.test(name)) return "news"
  return "other"
}

export function sourceConfigFromIntelligenceSource(source: IntelligenceSource): ManagedSourceConfig {
  const columns = source.columns ?? []
  const feed = Boolean(source.newsnowId)
  return {
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
    collectionMode: feed ? "feed" : columns.length ? "explicit" : "legacy-discovery",
    endpoints: columns.map((column, index) => ({
      id: `column-${index + 1}`,
      kind: inferSourceEndpointKind(column.name),
      name: column.name,
      url: column.url,
      enabled: true,
    })),
    ...(source.newsnowId ? { newsnowId: source.newsnowId } : {}),
  }
}

export function sourceConfigToIntelligenceSource(config: ManagedSourceConfig): IntelligenceSource & { collectionMode: SourceCollectionMode } {
  return {
    id: config.id,
    topic: config.topic,
    name: config.name,
    home: config.home,
    group: config.group,
    level: config.level,
    region: config.region,
    city: config.city,
    priority: config.priority,
    enabled: config.enabled,
    ...(config.newsnowId ? { newsnowId: config.newsnowId } : {}),
    ...(config.collectionMode === "explicit"
      ? { columns: config.endpoints.filter(endpoint => endpoint.enabled).map(endpoint => ({ name: endpoint.name, url: endpoint.url })) }
      : {}),
    collectionMode: config.collectionMode,
  }
}

export function sourceConfigurationStatus(config: ManagedSourceConfig): "configured" | "unconfigured" {
  if (config.collectionMode === "feed") return "configured"
  return config.collectionMode === "explicit" && config.endpoints.some(endpoint => endpoint.enabled) ? "configured" : "unconfigured"
}
