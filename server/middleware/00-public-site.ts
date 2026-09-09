import { createError, defineEventHandler, getRequestURL, setHeaders } from "h3"
import { isPublishedTopic, publicApiAllowed } from "@shared/public-site"

/** Runs before any legacy login/provider middleware; readers cannot trigger work. */
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  let path: string
  try { path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/" }
  catch { throw createError({ statusCode: 400, message: "请求地址无效" }) }
  if (!path.startsWith("/api")) return
  setHeaders(event, { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" })
  // Reject alternate encodings/separators instead of relying on router decoding.
  if (path.includes("\\") || path.includes("%") || path.includes("//") || !publicApiAllowed(path, event.method)) {
    throw createError({ statusCode: 404, message: "此功能暂未开放" })
  }
  if (event.method === "GET" || event.method === "HEAD") {
    const topics = url.searchParams.getAll("topic")
    if (topics.length > 1) throw createError({ statusCode: 400, message: "只能选择一个主题" })
    if (topics.length && !isPublishedTopic(topics[0])) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  }
})
