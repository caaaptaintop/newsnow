export const collectionWindowDays = 365

export function collectionCutoff(now = Date.now()) {
  const day = 24 * 60 * 60 * 1000
  const shanghaiOffset = 8 * 60 * 60 * 1000
  return Math.floor((now + shanghaiOffset) / day) * day - shanghaiOffset - collectionWindowDays * day
}

export function inCollectionWindow(item: { publishedAt?: number }, cutoff: number, now: number) {
  return Number.isFinite(item.publishedAt) && item.publishedAt! >= cutoff && item.publishedAt! <= now
}

export function collectionCandidates<T extends { key: string, publishedAt?: number }>(items: readonly T[], cutoff: number, now: number): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!inCollectionWindow(item, cutoff, now) || seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

/** Unknown dates cannot prove that the following pages are outside the window. */
export function pageEntirelyBeforeWindow(items: { publishedAt?: number }[], cutoff: number) {
  return items.length > 0 && items.every(item => Number.isFinite(item.publishedAt) && item.publishedAt! > 0 && item.publishedAt! < cutoff)
}
