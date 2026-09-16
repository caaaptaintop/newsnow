export const collectionWindowMonths = 3

// 根据北京时间（UTC+8）当日 00:00 向前计算自然月 cutoff，并在月末正确截断
export function collectionCutoff(now = Date.now(), months = collectionWindowMonths) {
  const shanghaiOffset = 8 * 60 * 60 * 1000
  const bjDate = new Date(now + shanghaiOffset)
  const year = bjDate.getUTCFullYear()
  const month = bjDate.getUTCMonth()
  const day = bjDate.getUTCDate()

  let targetYear = year
  let targetMonth = month - months
  while (targetMonth < 0) {
    targetMonth += 12
    targetYear -= 1
  }
  const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(day, maxDay)
  return Date.UTC(targetYear, targetMonth, targetDay) - shanghaiOffset
}

export function inCollectionWindow(item: { publishedAt?: number }, cutoff: number, now: number) {
  return Number.isFinite(item.publishedAt) && item.publishedAt! >= cutoff && item.publishedAt! <= now
}

export function publicationWindowDisposition(item: { publishedAt?: number, publicationDate?: { status?: string } }, cutoff: number, now: number): "publish" | "exclude" | "retry" {
  if (item.publicationDate?.status !== "verified") return "retry"
  return inCollectionWindow(item, cutoff, now) ? "publish" : "exclude"
}

export function collectionCandidates<T extends { key: string, publishedAt?: number }>(items: readonly T[], cutoff: number, now: number): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!inCollectionWindow(item, cutoff, now) || seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

// 未知日期的条目无法证明后续页面均在窗口之外
export function pageEntirelyBeforeWindow(items: { publishedAt?: number }[], cutoff: number) {
  return items.length > 0 && items.every(item => Number.isFinite(item.publishedAt) && item.publishedAt! > 0 && item.publishedAt! < cutoff)
}

// 已收录文章不受窗口截断影响，新增文章必须在采集窗口内
export function publicationArticleAllowed(
  item: { key: string, publishedAt?: number },
  existingKeys: Set<string> | ReadonlySet<string>,
  cutoff: number,
  now: number,
): boolean {
  if (existingKeys.has(item.key)) return true
  return inCollectionWindow(item, cutoff, now)
}
