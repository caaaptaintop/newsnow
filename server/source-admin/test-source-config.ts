import type { IntelligenceSource } from "../../shared/intelligence"
import type { IntelligenceSourceConfig } from "../../shared/source-config"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList } from "../utils/intelligence-parser"

function asSource(config: IntelligenceSourceConfig): IntelligenceSource {
  return {
    id: config.id,
    topic: config.topic as IntelligenceSource["topic"],
    name: config.name,
    home: config.home,
    group: config.group,
    level: config.level,
    region: config.region,
    city: config.city,
    priority: config.priority,
    enabled: config.enabled,
    newsnowId: config.newsnowId,
    columns: config.endpoints.filter(endpoint => endpoint.enabled).map(endpoint => ({ name: endpoint.name, url: endpoint.url })),
  }
}

export async function testSourceConfig(config: IntelligenceSourceConfig) {
  const source = asSource(config)
  if (config.collectionMode === "feed") {
    return { ok: true, mode: "feed", endpoints: [], message: "结构化信息流沿用现有读取器" }
  }
  if (config.collectionMode === "discover") {
    const page = await intelligenceFetchHtml(config.home, source)
    const candidates = intelligenceDiscoverColumns(page.html, source, page.url).map(column => ({ ...column }))
    return {
      ok: candidates.length > 0,
      mode: "discover",
      finalUrl: page.url,
      candidates,
      message: candidates.length
        ? `发现 ${candidates.length} 个候选栏目，发布前仍需人工选择并改为明确栏目模式`
        : "未发现可用栏目",
    }
  }
  const endpoints: Record<string, unknown>[] = []
  for (const endpoint of config.endpoints.filter(item => item.enabled).slice(0, 12)) {
    try {
      const page = await intelligenceFetchHtml(endpoint.url, source)
      const items = intelligenceParseList(page.html, source, { name: endpoint.name, url: page.url })
      endpoints.push({
        id: endpoint.id,
        kind: endpoint.kind,
        name: endpoint.name,
        url: endpoint.url,
        finalUrl: page.url,
        ok: items.length > 0,
        count: items.length,
        preview: items.slice(0, 5).map(item => ({ title: item.title, url: item.url, publishedAt: item.publishedAt })),
        message: items.length ? "" : "栏目页未解析到文章",
      })
    }
    catch (error) {
      endpoints.push({
        id: endpoint.id,
        kind: endpoint.kind,
        name: endpoint.name,
        url: endpoint.url,
        ok: false,
        count: 0,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const ok = endpoints.length > 0 && endpoints.every(endpoint => endpoint.ok)
  return {
    ok,
    mode: "explicit",
    endpoints,
    message: ok ? "全部启用栏目测试通过" : "至少一个启用栏目未通过测试",
  }
}
