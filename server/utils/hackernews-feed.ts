import * as cheerio from "cheerio"
import type { NewsItem } from "@shared/types"

/** Public official API: https://github.com/HackerNews/API */
export async function hackernewsFeed(): Promise<NewsItem[]> {
  const base = "https://hacker-news.firebaseio.com/v0"
  const read = async (path: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(12000) })
        if (!response.ok) throw new Error(`Hacker News API HTTP ${response.status}`)
        return await response.json()
      } catch (error) {
        if (attempt) throw error
      }
    }
    throw new Error("Hacker News API unavailable")
  }
  const ranked: any = await read("topstories")
  if (!Array.isArray(ranked)) throw new Error("Hacker News returned no ranking")
  const ids = ranked.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 30)
  const news: NewsItem[] = []
  for (let i = 0; i < ids.length; i += 5) {
    const wave: any[] = await Promise.all(ids.slice(i, i + 5).map(id => read(`item/${id}`)))
    for (const item of wave) {
      if (!item || item.deleted || item.dead || item.type !== "story" || typeof item.title !== "string") continue
      news.push({ id: String(item.id), title: cheerio.load(item.title).text(), url: `https://news.ycombinator.com/item?id=${item.id}`, pubDate: Number.isFinite(item.time) ? item.time * 1000 : undefined, extra: { info: `${item.score ?? 0} points` } })
    }
  }
  if (!news.length) throw new Error("Hacker News returned no readable stories")
  return news
}
