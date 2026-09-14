import type { IntelligenceSourceConfig, PublishedSourceConfig } from "./source-config"

export const collectionApprovalReason = "collection-confirmed"
const ministryColumns = new Map([
  ["政策发布", "https://www.mohurd.gov.cn/zhengcefabu/index.html"],
  ["建设要闻", "https://www.mohurd.gov.cn/xinwen/gzdt/index.html"],
  ["标准公告", "https://www.mohurd.gov.cn/gongkai/fdzdgknr/bzgg/index.html"],
  ["标准征求意见", "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html"],
])

export function sourceCollectionApproved(config: IntelligenceSourceConfig, reason: unknown) {
  if (reason === collectionApprovalReason) return true
  // Preserve only the explicitly verified legacy deployment, never all old publications.
  const endpoints = config.endpoints.filter(e => e.enabled)
  return reason === "publish" && config.id === "official-mohurd" && config.home === "https://www.mohurd.gov.cn/"
    && config.collectionMode === "explicit" && endpoints.length === 4
    && new Set(endpoints.map(e => e.name)).size === 4
    && endpoints.every(e => ministryColumns.get(e.name) === e.url)
}

export interface ApprovedSourceScope {
  sourceId: string
  columns: string[]
}

/** 提取当前已启用且已审批通过的公开来源范围与已启用栏目 */
export function extractApprovedSourceScope(configs?: PublishedSourceConfig[]): ApprovedSourceScope[] | undefined {
  if (!configs) return undefined
  return configs
    .filter(c => c.enabled && c.collectionApproved)
    .map(c => ({
      sourceId: c.id,
      columns: (c.endpoints ?? []).filter(e => e.enabled).map(e => e.name),
    }))
}

/** 检查文章是否在公开批准的来源与栏目范围内 */
export function isArticlePubliclyApproved(
  article: { sourceId?: string, column?: string },
  approvedScope?: ApprovedSourceScope[],
): boolean {
  if (!approvedScope) return true
  if (!article.sourceId || !article.column) return false
  return approvedScope.some(s => s.sourceId === article.sourceId && s.columns.includes(article.column!))
}
