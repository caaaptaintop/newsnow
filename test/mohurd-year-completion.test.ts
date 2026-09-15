import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { officialIntelligenceSources } from "../shared/official-sources"
import { collectSource } from "../tools/ai-bridge/collect-source"
import { evaluatePageNeedsMore } from "../tools/ai-bridge/collection-pagination"
import { collectionScopeKey } from "../tools/ai-bridge/collection-scope"
import { clearDetailCache } from "../tools/ai-bridge/detail-html-cache"
import { enrichOfficialArticle } from "../tools/ai-bridge/enrich-article"
import { verifyPublicationDate } from "../tools/ai-bridge/publication-date"
import { collectionCutoff, inCollectionWindow } from "../tools/ai-bridge/collection-window"
import { batchArticleKeys } from "../tools/ai-bridge/article-keys"

const rawMohurd = officialIntelligenceSources.find(s => s.id === "official-mohurd")!
const mohurdColumns = [
  { name: "政策发布", url: "https://www.mohurd.gov.cn/zhengcefabu/index.html" },
  { name: "建设要闻", url: "https://www.mohurd.gov.cn/xinwen/gzdt/index.html" },
  { name: "标准公告", url: "https://www.mohurd.gov.cn/gongkai/fdzdgknr/bzgg/index.html" },
  { name: "标准征求意见", url: "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html" },
]
const mohurd = { ...rawMohurd, enabled: true, columns: mohurdColumns }

describe("mohurd year completion and pagination integration", () => {
  beforeEach(() => {
    clearDetailCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearDetailCache()
  })

  it("evaluatePageNeedsMore handles stale scope, current scope, other sources, and disabled columns", () => {
    const approvedColumn = "政策发布"
    const disabledColumn = "未启用栏目"
    const testSource = {
      ...mohurd,
      columns: [{ name: approvedColumn, url: "https://www.mohurd.gov.cn/zhengcefabu/index.html" }],
      collectionMode: "explicit" as const,
    }

    const currentScope = collectionScopeKey(testSource)
    const now = Date.parse("2026-09-15T00:00:00+08:00")
    const cutoff = collectionCutoff(now)

    const staleUrl = "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_stale.html"
    const staleKey = batchArticleKeys("building", "official-mohurd", staleUrl)[0]
    const knownKey = batchArticleKeys("building", "official-mohurd", "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_known.html")[0]

    const baseStaleItem = {
      sourceId: "official-mohurd",
      key: staleKey,
      title: "待恢复Scope的政策通知",
      column: approvedColumn,
      publishedAt: Date.parse("2026-06-15T00:00:00+08:00"),
      collectionScope: undefined, // stale scope
    }

    const knownRecords = [{ key: knownKey, title: "已知通知" }]
    const knownPageItems = [{ url: "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_known.html", title: "已知通知", column: approvedColumn, publishedAt: Date.parse("2026-08-01T00:00:00+08:00") }]

    // 1. 本栏目有未处理、在近三个月、collectionScope != 当前scope的批准候选时，允许继续
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [baseStaleItem],
      knownRecords,
    })).toBe(true)

    // 2. 候选 collectionScope 已经等于 currentScope，不触发穿透（因页面全为 known，返回 false）
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [{ ...baseStaleItem, collectionScope: currentScope }],
      knownRecords,
    })).toBe(false)

    // 3. 候选属于其他来源，不触发本来源的穿透
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [{ ...baseStaleItem, sourceId: "other-source" }],
      knownRecords,
    })).toBe(false)

    // 4. 候选属于未启用/停用栏目，不触发穿透
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [{ ...baseStaleItem, column: disabledColumn }],
      knownRecords,
    })).toBe(false)

    // 5. 候选发布时间早于三个月边界（已过期），不触发穿透
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [{ ...baseStaleItem, publishedAt: Date.parse("2026-06-14T23:59:59+08:00") }],
      knownRecords,
    })).toBe(false)

    // 6. 候选已在 knownSet 中（已处理），不触发穿透
    expect(evaluatePageNeedsMore({
      source: testSource,
      items: knownPageItems,
      cutoff,
      now,
      priorPendingCandidates: [baseStaleItem],
      knownRecords: [...knownRecords, { key: baseStaleItem.key, title: baseStaleItem.title }],
    })).toBe(false)
  })

  it("paginates past all-known page 1 to reach stale candidate on page 3 using evaluatePageNeedsMore", async () => {
    const now = Date.parse("2026-09-15T00:00:00+08:00")
    const cutoff = collectionCutoff(now)
    const staleUrl = "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_stale_3.html"
    const staleItem = {
      key: batchArticleKeys("building", "official-mohurd", staleUrl)[0],
      sourceId: "official-mohurd",
      title: "关于印发第三批绿色低碳建筑试点通知",
      url: staleUrl,
      column: "政策发布",
      publishedAt: Date.parse("2026-06-15T00:00:00+08:00"),
    }

    const priorPendingCandidates = [staleItem]
    const knownRecords = [
      { key: batchArticleKeys("building", "official-mohurd", "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p1_1.html")[0], title: "关于推进城市基础设施更新改造的通知" },
      { key: batchArticleKeys("building", "official-mohurd", "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p2_1.html")[0], title: "关于印发保障性住房建设标准的通知" },
    ]

    const html = (rows: Array<{ title: string, url: string, date: string }>, next?: string) =>
      `<ul>${rows.map(i => `<li><a href="${i.url}">${i.title}</a><span>${i.date}</span></li>`).join("")}</ul>${next ? `<a rel="next" href="${next}">下一页</a>` : ""}`

    const p1Url = "https://www.mohurd.gov.cn/zhengcefabu/index.html"
    const p2Url = "https://www.mohurd.gov.cn/zhengcefabu/index_2.html"
    const p3Url = "https://www.mohurd.gov.cn/zhengcefabu/index_3.html"

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url === p1Url) {
        return new Response(html([{ title: "关于推进城市基础设施更新改造的通知", url: "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p1_1.html", date: "2026-08-01" }], p2Url), { headers: { "content-type": "text/html" } })
      }
      if (url === p2Url) {
        return new Response(html([{ title: "关于印发保障性住房建设标准的通知", url: "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p2_1.html", date: "2026-07-01" }], p3Url), { headers: { "content-type": "text/html" } })
      }
      if (url === p3Url) {
        return new Response(html([{ title: staleItem.title, url: staleItem.url, date: "2026-06-15" }]), { headers: { "content-type": "text/html" } })
      }
      return new Response("Not found", { status: 404 })
    })

    const column = { name: "政策发布", url: p1Url }
    const sourceWithOneCol = { ...mohurd, columns: [column], collectionMode: "explicit" }

    const result = await collectSource(sourceWithOneCol, {
      maxPages: null,
      shouldContinuePage: items => evaluatePageNeedsMore({
        source: sourceWithOneCol,
        items,
        cutoff,
        now,
        priorPendingCandidates,
        knownRecords,
      }),
    })

    expect(result.items.map(i => i.title)).toContain(staleItem.title)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("stops at page 1 when all items on page 1 are known and no stale candidates exist", async () => {
    const now = Date.parse("2026-09-15T00:00:00+08:00")
    const cutoff = collectionCutoff(now)
    const p1Url = "https://www.mohurd.gov.cn/zhengcefabu/index.html"
    const p2Url = "https://www.mohurd.gov.cn/zhengcefabu/index_2.html"

    const knownTitle = "关于推进城市基础设施更新改造的通知"
    const html = (rows: Array<{ title: string, url: string, date: string }>, next?: string) =>
      `<ul>${rows.map(i => `<li><a href="${i.url}">${i.title}</a><span>${i.date}</span></li>`).join("")}</ul>${next ? `<a rel="next" href="${next}">下一页</a>` : ""}`

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url === p1Url) {
        return new Response(html([{ title: knownTitle, url: "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p1_1.html", date: "2026-08-01" }], p2Url), { headers: { "content-type": "text/html" } })
      }
      return new Response("Not found", { status: 404 })
    })

    const column = { name: "政策发布", url: p1Url }
    const sourceWithOneCol = { ...mohurd, columns: [column], collectionMode: "explicit" }
    const knownRecords = [{ key: batchArticleKeys("building", "official-mohurd", "https://www.mohurd.gov.cn/zhengcefabu/art/2026/art_p1_1.html")[0], title: knownTitle }]

    const result = await collectSource(sourceWithOneCol, {
      maxPages: null,
      shouldContinuePage: items => evaluatePageNeedsMore({
        source: sourceWithOneCol,
        items,
        cutoff,
        now,
        priorPendingCandidates: [],
        knownRecords,
      }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.items.length).toBe(1)
    expect(result.items[0].title).toBe(knownTitle)
  })

  it("reuses cached detail across collectSource, enrichOfficialArticle, and verifyPublicationDate (exactly 1 detail fetch)", async () => {
    const listUrl = "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html"
    const detailUrl = "https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2026/art_396a333e810a49b1bf5eb1e797a28f3f.html"

    const listHtml = `<ul><li><a href="${detailUrl}">住房城乡建设部办公厅关于国家标准《便携式管线探测设备技术要求（征求意见稿）》公开征求意见的通知</a></li></ul>`
    const bodyText = "住房城乡建设部关于便携式管线探测设备技术要求征求意见稿的通知正文内容，详细文本长度超过八十个字符以确保通过解析器对文章主体的长度阈值要求并正常提取正文内容。".repeat(2)
    const detailHtml = `<meta name="PubDate" content="2026-09-02 16:00:00">
      <div class="editorContent-box"><div class="editorContent-top">操作</div>
      <div class="editor-content"><p>${bodyText}</p></div></div>`

    let detailFetchCount = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url === listUrl) {
        return new Response(listHtml, { headers: { "content-type": "text/html" } })
      }
      if (url === detailUrl) {
        detailFetchCount++
        return new Response(detailHtml, { headers: { "content-type": "text/html" } })
      }
      return new Response("Not found", { status: 404 })
    })

    const column = { name: "标准征求意见", url: listUrl }
    const sourceWithOneCol = { ...mohurd, columns: [column], collectionMode: "explicit" }

    // 1. 采集列表并自动补齐日期
    const collectResult = await collectSource(sourceWithOneCol, { maxPages: 1 })
    expect(collectResult.items.length).toBe(1)
    const item = collectResult.items[0]
    expect(item.publishedAt).toBe(Date.parse("2026-09-02T16:00:00+08:00"))
    expect(detailFetchCount).toBe(1)

    // 2. 调用 enrichOfficialArticle 解析正文富化，应命中缓存，不发起第2次请求
    const enrichment = await enrichOfficialArticle(sourceWithOneCol, item, { ...item, attachments: [] })
    expect(enrichment.text).toContain("便携式管线探测设备")
    expect(detailFetchCount).toBe(1)

    // 3. 调用 verifyPublicationDate 核验发布日期，应命中缓存，不发起第3次请求
    const dateProof = await verifyPublicationDate(sourceWithOneCol, item)
    expect(dateProof.publishedAt).toBe(Date.parse("2026-09-02T16:00:00+08:00"))
    expect(dateProof.publicationDate?.status).toBe("verified")
    expect(detailFetchCount).toBe(1)
  })

  it("handles deadline/dateModified without PubDate, HTTP failures with unknown status and warnings", async () => {
    const listUrl = "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html"
    const failUrl = "https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2026/art_http_fail.html"
    const noPubDateUrl = "https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2026/art_no_pubdate.html"
    const oldPubDateUrl = "https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2026/art_old_pubdate.html"

    const listHtml = `<ul>
      <li><a href="${failUrl}">网络请求失败的标准征求意见</a></li>
      <li><a href="${noPubDateUrl}">仅有截止日期与修改时间的标准</a></li>
      <li><a href="${oldPubDateUrl}">三年前发布的历史标准文件</a></li>
    </ul>`

    const noPubDateHtml = `<html><head><meta property="article:modified_time" content="2026-09-09"><meta name="deadline" content="2026-10-01"></head><body><h1>无官方发布日期</h1></body></html>`
    const oldPubDateHtml = `<html><head><meta name="PubDate" content="2021-05-01 09:00:00"></head><body><h1>老旧标准通知</h1></body></html>`

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url === listUrl) return new Response(listHtml, { headers: { "content-type": "text/html" } })
      if (url === failUrl) return new Response("500 Server Error", { status: 500 })
      if (url === noPubDateUrl) return new Response(noPubDateHtml, { headers: { "content-type": "text/html" } })
      if (url === oldPubDateUrl) return new Response(oldPubDateHtml, { headers: { "content-type": "text/html" } })
      return new Response("Not found", { status: 404 })
    })

    const column = { name: "标准征求意见", url: listUrl }
    const sourceWithOneCol = { ...mohurd, columns: [column], collectionMode: "explicit" }

    const result = await collectSource(sourceWithOneCol, { maxPages: 1 })

    // 汇总缺日期和抓取失败到 warnings
    expect(result.warnings.some(w => w.includes("未取得官方有效发布日期"))).toBe(true)
    expect(result.warnings.some(w => w.includes("详情时间获取失败"))).toBe(true)

    // HTTP 失败项保留 undefined
    const failItem = result.items.find(i => i.url === failUrl)!
    expect(failItem.publishedAt).toBeUndefined()

    // 仅有修改时间和截止日期的条目保留 undefined，绝不篡改
    const noPubItem = result.items.find(i => i.url === noPubDateUrl)!
    expect(noPubItem.publishedAt).toBeUndefined()

    // 旧 PubDate 成功解析出三年前真实日期，但被 inCollectionWindow 排除
    const oldItem = result.items.find(i => i.url === oldPubDateUrl)!
    expect(oldItem.publishedAt).toBe(Date.parse("2021-05-01T09:00:00+08:00"))
    const now = Date.parse("2026-09-15T00:00:00+08:00")
    const cutoff = collectionCutoff(now)
    expect(inCollectionWindow(oldItem, cutoff, now)).toBe(false)
  })
})
