import type { IntelligenceSourceConfig } from "./source-config"

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
