import { afterEach, expect, it, vi } from "vitest"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceFetchList } from "../server/utils/intelligence-dynamic-list"
import { batchArticleKeys, pageHasUnprocessed } from "../tools/ai-bridge/article-keys"
import { collectionCutoff, pageEntirelyBeforeWindow } from "../tools/ai-bridge/collection-window"

const source = intelligenceSources.find(s => s.id === "official-mohurd")!
const column = { name: "政策发布", url: new URL("zhengcefabu/index.html", source.home).href }
const old = { title: "关于公布已处理事项的通知", url: new URL("zhengcefabu/art/2026/art_old.html", source.home).href }
const fresh = { title: "关于印发住宅项目规范的通知", url: new URL("zhengcefabu/art/2026/art_new.html", source.home).href }
const known = [{ key: batchArticleKeys("building", source.id, old.url)[0], title: old.title }]
afterEach(() => vi.restoreAllMocks())
it("pinned processed titles do not stop a mixed page, changed titles remain new", () => {
  expect(pageHasUnprocessed("building", source.id, [old, fresh], known)).toBe(true)
  expect(pageHasUnprocessed("building", source.id, [old], known)).toBe(false)
  expect(pageHasUnprocessed("building", source.id, [{ ...old, title: "原地址更新后的标题" }], known)).toBe(true)
  expect(pageHasUnprocessed("building", source.id, [], known)).toBe(false)
  const revised = { ...old, title: "原地址更新后的标题" }
  expect(pageHasUnprocessed("building", source.id, [old, revised], [...known, { ...known[0], title: revised.title }])).toBe(false)
})
const html = (rows: typeof old[], next: string) => `<ul>${rows.map(i => `<li><a href="${i.url}">${i.title}</a><span>2026-09-08</span></li>`).join("")}</ul><a rel="next" href="${next}">下一页</a>`
it.each(["static", "dynamic"])("%s uses the date boundary even beyond 100 pages", async (mode) => {
  let pageNumber = 0
  let shell = false
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (mode === "dynamic" && !shell) {
      shell = true
      return new Response("<script>const endpoint=\"/api-gateway/jpaas-publish-server/front/page/build/unit\"; const unit={parseType:\"bulidstatic\",webId:\"web\",tplSetId:\"tpl\",pageType:\"column\",tagId:\"list\",pageId:\"page\"};</script>", { headers: { "content-type": "text/html" } })
    }
    pageNumber++
    const item = { title: `第${pageNumber}页住宅项目规范的通知`, url: new URL(`zhengcefabu/art/2026/art_${pageNumber}.html`, source.home).href }
    let fragment = html([item], `index_${pageNumber + 1}.html`)
    if (pageNumber === 102) fragment = fragment.replaceAll("2026-09-08", "2024-09-08")
    return mode === "dynamic" ? Response.json({ data: { html: `${fragment}<a data-page="${pageNumber + 1}">下一页</a>` } }) : new Response(fragment, { headers: { "content-type": "text/html" } })
  })
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: null, shouldContinue: items => !pageEntirelyBeforeWindow(items, collectionCutoff(Date.parse("2026-09-15T00:00:00+08:00"))) })
  expect(page.pages).toBe(102)
  expect(page.capped).toBe(false)
  expect(pageNumber).toBe(102)
})
it("static next links continue past a pinned duplicate then stop on an all-known page", async () => {
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(html([old, fresh], "index_2.html"), { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response(html([old], "index_3.html"), { headers: { "content-type": "text/html" } }))
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: 100, shouldContinue: items => pageHasUnprocessed("building", source.id, items, known) })
  expect(page.pages).toBe(2)
  expect(page.items.map(i => i.title)).toContain(fresh.title)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(page.capped).toBe(false)
})
it("jPaas continues beyond the former five-page limit", async () => {
  const shell = "<script>const endpoint=\"/api-gateway/jpaas-publish-server/front/page/build/unit\"; const unit={parseType:\"bulidstatic\",webId:\"web\",tplSetId:\"tpl\",pageType:\"column\",tagId:\"list\",pageId:\"page\"};</script>"
  let requests = 0
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    requests++
    if (requests === 1) return new Response(shell, { headers: { "content-type": "text/html" } })
    const n = requests - 1
    const item = n === 7 ? old : { title: `第${n}页住宅项目规范的通知`, url: new URL(`zhengcefabu/art/2026/art_${n}.html`, source.home).href }
    const fragment = `${html([item], "javascript:;")}<a data-page="${n + 1}">下一页</a>`
    return Response.json({ data: { html: fragment } })
  })
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: 100, shouldContinue: items => pageHasUnprocessed("building", source.id, items, known) })
  expect(page.pages).toBe(7)
  expect(requests).toBe(8)
  expect(page.capped).toBe(false)
})
it("a known lookup failure retains the fetched page and reports incomplete pagination", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html([fresh], "index_2.html"), { headers: { "content-type": "text/html" } }))
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: 100, shouldContinue: async () => {
    throw new Error("known unavailable")
  } })
  expect(page.items.map(i => i.title)).toContain(fresh.title)
  expect("paginationError" in page && page.paginationError).toBe("known unavailable")
  expect(fetch).toHaveBeenCalledTimes(1)
})
it("failure on a later static page retains earlier page items", async () => {
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(html([fresh], "index_2.html"), { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response("denied", { status: 403 }))
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: 100, shouldContinue: async () => true })
  expect(page.items.map(i => i.title)).toContain(fresh.title)
  expect("paginationError" in page && page.paginationError).toContain("403")
  expect(fetch).toHaveBeenCalledTimes(2)
})
it("same URLs with changed titles are retained, identical pages still stop", async () => {
  const changed = { ...old, title: "关于公布修订后住宅规范的通知" }
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(html([old], "index_2.html"), { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response(html([changed], "index_3.html"), { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response(html([changed], "index_4.html"), { headers: { "content-type": "text/html" } }))
  const page = await intelligenceFetchList(column.url, source, column, { maxPages: 100, shouldContinue: async () => true })
  expect(page.items.map(i => i.title)).toEqual([old.title, changed.title])
  expect("paginationStalled" in page && page.paginationStalled).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(3)
})
