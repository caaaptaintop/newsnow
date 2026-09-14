import type { IntelligenceSource } from "../../shared/intelligence"

export const collectionSourceId = "official-mohurd"
export const collectionColumns = new Map([
  ["政策发布", "https://www.mohurd.gov.cn/zhengcefabu/index.html"],
  ["建设要闻", "https://www.mohurd.gov.cn/xinwen/gzdt/index.html"],
  ["标准公告", "https://www.mohurd.gov.cn/gongkai/fdzdgknr/bzgg/index.html"],
  ["标准征求意见", "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html"],
])

export function collectionSourceAllowed(id: string) {
  return id === collectionSourceId
}

export function collectionItemAllowed(item: { sourceId: string, column?: string }) {
  return collectionSourceAllowed(item.sourceId) && collectionColumns.has(item.column ?? "")
}

export function assertCollectionColumns(source: IntelligenceSource) {
  if (!collectionSourceAllowed(source.id) || source.columns?.length !== collectionColumns.size
    || new Set(source.columns.map(column => column.name)).size !== collectionColumns.size
    || source.columns.some(column => collectionColumns.get(column.name) !== column.url)) {
    throw new Error("采集范围必须是已核验的住建部四栏目；配置变更需重新核验")
  }
}
