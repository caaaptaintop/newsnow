import type { ManagedSourceConfig } from "../../shared/source-config"
import { inferSourceEndpointKind, sourceConfigToIntelligenceSource } from "../../shared/source-config"
import { collectSource } from "../utils/intelligence-collector"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseArticle } from "../utils/intelligence-parser"
import { normalizeManagedSourceConfig } from "./model"

export async function discoverSourceEndpoints(input: unknown) {
  const config = normalizeManagedSourceConfig(input)
  const source = sourceConfigToIntelligenceSource({ ...config, collectionMode: "legacy-discovery", endpoints: [] })
  const homepage = await intelligenceFetchHtml(source.home, source)
  return intelligenceDiscoverColumns(homepage.html, source, homepage.url).map((column, index) => ({
    id: `candidate-${index + 1}`,
    kind: inferSourceEndpointKind(column.name),
    name: column.name,
    url: column.url,
    enabled: true,
  }))
}

export async function testSourceConfiguration(input: unknown, endpointId?: string) {
  let config: ManagedSourceConfig = normalizeManagedSourceConfig(input)
  if (endpointId) {
    const endpoint = config.endpoints.find(item => item.id === endpointId)
    if (!endpoint) throw new Error("待测试栏目不存在")
    config = { ...config, collectionMode: "explicit", endpoints: [{ ...endpoint, enabled: true }] }
  }
  const source = sourceConfigToIntelligenceSource(config)
  const collected = await collectSource(source)
  const samples = []
  for (const candidate of collected.items.slice(0, 3)) {
    try {
      const page = await intelligenceFetchHtml(candidate.url, source)
      const article = intelligenceParseArticle(page.html, candidate, source)
      samples.push({ title: article.title, url: article.url, publishedAt: article.publishedAt ?? null, attachments: article.attachments.slice(0, 5) })
    } catch (error: any) {
      samples.push({ title: candidate.title, url: candidate.url, publishedAt: candidate.publishedAt ?? null, attachments: [], warning: String(error?.message || error) })
    }
  }
  return {
    ok: true,
    columns: collected.columns,
    warnings: collected.warnings,
    candidateCount: collected.items.length,
    datedCount: collected.items.filter(item => Number.isFinite(item.publishedAt)).length,
    sampleAttachments: samples.reduce((sum, item) => sum + item.attachments.length, 0),
    samples,
  }
}
