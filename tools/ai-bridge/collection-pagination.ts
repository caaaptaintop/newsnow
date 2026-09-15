import type { IntelligenceSource } from "../../shared/intelligence"
import { pageHasUnprocessed } from "./article-keys"
import { collectionItemAllowed, collectionScopeKey } from "./collection-scope"
import { pageEntirelyBeforeWindow } from "./collection-window"

export interface PageNeedsMoreOptions {
  source: IntelligenceSource
  items: Array<{ url: string, title: string, column?: string, publishedAt?: number }>
  cutoff: number
  now: number
  priorPendingCandidates?: Array<{ sourceId: string, collectionScope?: string, column?: string, key: string, title: string, publishedAt?: number }>
  knownRecords?: Array<{ key: string, title: string }>
}

export function evaluatePageNeedsMore(options: PageNeedsMoreOptions): boolean {
  const { source, items, cutoff, now, priorPendingCandidates = [], knownRecords = [] } = options
  if (pageEntirelyBeforeWindow(items, cutoff)) return false
  if (!items.length) return false

  const currentScope = collectionScopeKey(source)
  const columnNames = new Set(items.map(i => i.column).filter(Boolean))
  const knownSet = new Set(knownRecords.map(r => JSON.stringify([r.key, r.title])))

  const staleScopeCandidates = priorPendingCandidates.filter((item) => {
    if (item.sourceId !== source.id) return false
    if (item.collectionScope === currentScope) return false
    if (!collectionItemAllowed(item, [source])) return false
    if (columnNames.size > 0 && !columnNames.has(item.column)) return false
    const itemVersion = JSON.stringify([item.key, item.title])
    if (knownSet.has(itemVersion)) return false
    return Number.isFinite(item.publishedAt) && item.publishedAt! >= cutoff && item.publishedAt! <= now
  })

  const hasStaleScopeToRecover = staleScopeCandidates.length > 0
  return hasStaleScopeToRecover || pageHasUnprocessed(source.topic, source.id, items, knownRecords)
}
