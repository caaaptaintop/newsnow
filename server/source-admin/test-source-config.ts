import { intelligenceSources } from "../../shared/official-sources"
import type { IntelligenceSourceConfig } from "../../shared/source-config"
import { applyIntelligenceSourceConfig, sourceConfigCanPublish, validateIntelligenceSourceConfig } from "../../shared/source-config"
import { intelligenceDiscoverColumns, intelligenceFetchHtml } from "../utils/intelligence-parser"
import { intelligenceFetchList } from "../utils/intelligence-dynamic-list"

import { SourceFetchError, type SourceFetchDiagnostic } from "../utils/source-fetch-diagnostic"

export interface SourceEndpointTest {
  id: string
  url: string
  finalUrl?: string
  status?: "passed" | "failed" | "untested"
  diagnostic?: SourceFetchDiagnostic
  name: string
  ok: boolean
  count: number
  preview: { title: string, url: string, publishedAt?: number }[]
  message: string
}
export interface SourceConfigTestResult {
  schemaVersion: 1
  mode: string
  ok: boolean
  publishable: boolean
  endpoints: SourceEndpointTest[]
  candidates?: { name: string, url: string }[]
  executor?: "cloud" | "mac"
  runtimePending?: boolean
  message: string
}

export function sourceTestNeedsRuntimeFallback(value: SourceConfigTestResult) {
  return value.mode === "explicit" && value.endpoints.length > 0
    && value.endpoints.every(endpoint => !endpoint.ok && endpoint.status !== "untested"
      && endpoint.diagnostic?.category === "cloudflare_dns")
}
/** Recheck the result contract, not a caller-provided ok flag or a discovery success. */
export function sourceTestAllowsPublish(config: IntelligenceSourceConfig, value: unknown): value is SourceConfigTestResult {
  if (!value || typeof value !== "object" || Array.isArray(value) || !sourceConfigCanPublish(config)) return false
  const result = value as SourceConfigTestResult
  if (result.schemaVersion !== 1 || result.ok !== true || result.publishable !== true || !Array.isArray(result.endpoints)) return false
  if (!config.enabled) return result.mode === "disabled" && result.endpoints.length === 0
  if (config.collectionMode !== "explicit" || result.mode !== "explicit") return false
  const endpoints = config.endpoints.filter(endpoint => endpoint.enabled)
  return endpoints.length > 0 && endpoints.length === result.endpoints.length
    && endpoints.every((endpoint, index) => {
      const test = result.endpoints[index]
      return test?.id === endpoint.id && test.url === endpoint.url && test.ok === true
        && Number.isInteger(test.count) && test.count > 0 && Array.isArray(test.preview) && test.preview.length > 0
    })
}
export async function testSourceConfig(value: IntelligenceSourceConfig): Promise<SourceConfigTestResult> {
  const seed = intelligenceSources.find(source => source.id === value.id && source.topic === value.topic)
  if (!seed) throw new Error("未注册的信息源")
  const config = validateIntelligenceSourceConfig(value, seed)
  const source = applyIntelligenceSourceConfig(seed, config)
  // Disabling a broken source must not depend on its website being available.
  if (!config.enabled) return { schemaVersion: 1, ok: true, publishable: true, mode: "disabled", endpoints: [], message: "已验证停用配置；未访问原站" }
  if (config.collectionMode === "feed") return {
    schemaVersion: 1, ok: false, publishable: false, mode: "feed", endpoints: [],
    message: "此主题的结构化读取器尚未开放配置测试；可保存草稿，不可据此发布或启用采集",
  }
  if (config.collectionMode === "discover") {
    const page = await intelligenceFetchHtml(config.home, source)
    const candidates = intelligenceDiscoverColumns(page.html, { ...source, columns: [] }, page.url)
    return { schemaVersion: 1, ok: candidates.length > 0, publishable: false, mode: "discover", endpoints: [], candidates,
      message: candidates.length ? "仅发现候选。请选择实际栏目，切换到明确栏目后重新测试" : "未发现可用栏目" }
  }
  const endpoints: SourceEndpointTest[] = []
  const deadline = Date.now() + 45_000
  for (const endpoint of config.endpoints.filter(item => item.enabled)) {
    const record: SourceEndpointTest = { id: endpoint.id, name: endpoint.name, url: endpoint.url, ok: false, count: 0, preview: [], message: "" }
    try {
      if (Date.now() >= deadline) { record.status = "untested"; throw new Error("本次测试达到时间预算；此栏目未测试") }
      const page = await intelligenceFetchList(endpoint.url, source, { name: endpoint.name, url: endpoint.url }, { maxPages: 1 })
      const items = page.items
      Object.assign(record, { finalUrl: page.url, status: items.length ? "passed" : "failed", ok: items.length > 0, count: items.length,
        preview: items.slice(0, 5).map(item => ({ title: item.title, url: item.url, publishedAt: item.publishedAt })),
        message: items.length ? "请人工确认标题样本是否属于目标栏目；缺少日期不等于当天发布" : "栏目页未解析到文章" })
    }
    catch (error) {
      record.status ??= "failed"
      record.message = error instanceof Error ? error.message.slice(0, 240) : "栏目测试失败"
      if (error instanceof SourceFetchError) record.diagnostic = error.diagnostic
    }
    endpoints.push(record)
  }
  const ok = endpoints.length > 0 && endpoints.every(endpoint => endpoint.ok)
  return { schemaVersion: 1, ok, publishable: ok, mode: "explicit", endpoints, message: ok ? "全部启用栏目可解析；请确认预览内容后发布" : `以下栏目未通过或未测试：${endpoints.filter(endpoint => !endpoint.ok).map(endpoint => endpoint.name).join("、")}；当前草稿不能发布` }
}
