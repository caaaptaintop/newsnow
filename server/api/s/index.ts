import type { SourceID, SourceResponse } from "@shared/types"
import { getters } from "#/getters"
import { getCacheTable } from "#/database/cache"
import type { CacheInfo } from "#/types"

const info = {
  LICENCE: "MIT",
  Github: "https://github.com/ourongxing/newsnow",
  Sponsorship: "If you rely on this service, sponsorship is welcome to help it run for the long term. Scan the QR code https://raw.githubusercontent.com/ourongxing/newsnow/main/screenshots/reward.gif",
}

function parseLimit(raw: unknown) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 30
  return Math.min(100, Math.max(1, Math.floor(n)))
}

export default defineEventHandler(async (event): Promise<SourceResponse> => {
  try {
    const query = getQuery(event)
    const latest = query.latest !== undefined && query.latest !== "false"
    const limit = parseLimit(query.limit)
    let id = query.id as SourceID
    const isValid = (id: SourceID) => !id || !sources[id] || !getters[id]

    if (isValid(id)) {
      const redirectID = sources?.[id]?.redirect
      if (redirectID) id = redirectID
      if (isValid(id)) throw new Error("Invalid source id")
    }

    // 普通页面继续沿用原缓存；主题页的大窗口单独缓存，互不影响。
    const cacheKey = limit === 30 ? id : `${id}:limit:${limit}`
    const cacheTable = await getCacheTable()
    // Date.now() in Cloudflare Worker will not update throughout the entire runtime.
    const now = Date.now()
    let cache: CacheInfo | undefined
    if (cacheTable) {
      cache = await cacheTable.get(cacheKey)
      if (cache) {
        // interval 刷新间隔，对于缓存失效也要执行的。本质上表示本来内容更新就很慢，这个间隔内可能内容压根不会更新。
        // 默认 10 分钟，是低于 TTL 的，但部分 Source 的更新间隔会超过 TTL，甚至有的一天更新一次。
        if (now - cache.updated < sources[id].interval) {
          return {
            status: "success",
            id,
            updatedTime: now,
            items: cache.items.slice(0, limit),
            info,
          }
        }

        // 而 TTL 缓存失效时间，在时间范围内，就算内容更新了也要用这个缓存。
        // 复用缓存是不会更新时间的。
        if (now - cache.updated < TTL) {
          if (!latest || (!event.context.disabledLogin && !event.context.user)) {
            return {
              status: "cache",
              id,
              updatedTime: cache.updated,
              items: cache.items.slice(0, limit),
              info,
            }
          }
        }
      }
    }

    try {
      const newData = (await getters[id]()).slice(0, limit)
      if (cacheTable && newData.length) {
        if (event.context.waitUntil) event.context.waitUntil(cacheTable.set(cacheKey, newData))
        else await cacheTable.set(cacheKey, newData)
      }
      logger.success(`fetch ${id} latest (limit=${limit})`)
      return {
        status: "success",
        id,
        updatedTime: now,
        items: newData,
        info,
      }
    } catch (e) {
      if (cache!) {
        return {
          status: "cache",
          id,
          updatedTime: cache.updated,
          items: cache.items.slice(0, limit),
          info,
        }
      } else {
        throw e
      }
    }
  } catch (e: any) {
    logger.error(e)
    throw createError({
      statusCode: 500,
      message: e instanceof Error ? e.message : "Internal Server Error",
    })
  }
})
