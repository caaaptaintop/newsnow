import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { activateBuilding, buildingMeta, initializeBuilding, knownRecords, publishBatch } from "../server/building/store"
import { readPage, readVersion } from "../server/building/read"
import { buildingLimits, normalizeBatchItem } from "../shared/building-contract"
import type { PublishedSourceConfig } from "../shared/source-config"
import { extractApprovedSourceScope, isArticlePubliclyApproved } from "../shared/source-collection-approval"
import { memoryBuildingDB } from "./helpers/building-db"

const now = 1788960000000

function makeArticle(i: number, sourceId: string, column: string, extra: any = {}) {
  const key = `building:${createHash("sha256").update(`${sourceId}-${column}-${i}`).digest("hex")}`
  return normalizeBatchItem({
    kind: "article",
    key,
    data: {
      key,
      topic: "building",
      title: extra.title ?? `测试文章${i}-${sourceId}`,
      url: `https://example.gov.cn/a/${i}`,
      sourceId,
      sourceName: sourceId === "official-mohurd" ? "住建部" : "其他部门",
      sourceGroup: "住建官方",
      sourceLevel: "部委",
      region: sourceId === "official-mohurd" ? "全国" : "上海",
      city: sourceId === "official-mohurd" ? "北京" : "上海",
      column,
      publishedAt: now - i * 1000,
      collectedAt: now,
      publicationDate: { status: "verified", basis: "article", url: `https://example.gov.cn/a/${i}`, checkedAt: now },
      category: extra.category ?? "intelligent_construction",
      relatedCategories: [],
      tags: extra.tags ?? ["节能"],
      contentType: "通知公告",
      importance: 80,
      summary: extra.summary ?? "摘要测试",
      evidence: "title",
      attachments: extra.attachments ?? [],
      model: "unit-test-model",
      analysisVersion: "v3-test",
    },
  })
}

const mohurdApprovedConfig: PublishedSourceConfig = {
  schemaVersion: 1,
  id: "official-mohurd",
  topic: "building",
  name: "住房和城乡建设部",
  home: "https://www.mohurd.gov.cn/",
  group: "住建官方",
  level: "部委",
  region: "全国",
  city: "北京",
  priority: 100,
  enabled: true,
  collectionApproved: true,
  collectionMode: "explicit",
  endpoints: [
    { id: "mohurd-zc", kind: "policy", name: "政策发布", url: "https://www.mohurd.gov.cn/zhengcefabu/index.html", enabled: true },
    { id: "mohurd-yw", kind: "notice", name: "建设要闻", url: "https://www.mohurd.gov.cn/xinwen/gzdt/index.html", enabled: true },
    { id: "mohurd-bz", kind: "standard", name: "标准公告", url: "https://www.mohurd.gov.cn/gongkai/fdzdgknr/bzgg/index.html", enabled: true },
    { id: "mohurd-zq", kind: "standard", name: "标准征求意见", url: "https://www.mohurd.gov.cn/gongkai/fdzdgknr/zqyj/index.html", enabled: true },
  ],
}

const unapprovedOtherConfig: PublishedSourceConfig = {
  schemaVersion: 1,
  id: "official-shanghai",
  topic: "building",
  name: "上海市住房和城乡建设管理委员会",
  home: "https://zjw.sh.gov.cn/",
  group: "省级住建",
  level: "省级",
  region: "上海",
  city: "上海",
  priority: 60,
  enabled: true,
  collectionApproved: false,
  collectionMode: "explicit",
  endpoints: [
    { id: "sh-notice", kind: "notice", name: "通知公告", url: "https://zjw.sh.gov.cn/notice/", enabled: true },
  ],
}

describe("公开读取受动态来源审批范围约束", () => {
  let memory: ReturnType<typeof memoryBuildingDB>

  beforeEach(async () => {
    memory = memoryBuildingDB()
    await initializeBuilding(memory.db)
  })

  afterEach(() => memory.sqlite.close())

  async function seedDatabase() {
    const mohurdArticles = [
      makeArticle(1, "official-mohurd", "政策发布", { title: "住建部绿色建筑发展新政", tags: ["绿建"] }),
      makeArticle(2, "official-mohurd", "建设要闻", { title: "城市更新推进工作会议", tags: ["城市更新"] }),
      makeArticle(3, "official-mohurd", "标准公告", { title: "装配式住宅国家标准公告", tags: ["装配式"] }),
      makeArticle(4, "official-mohurd", "标准征求意见", { title: "建筑碳排放征求意见", tags: ["低碳"] }),
    ]
    const unapprovedArticles = [
      makeArticle(5, "official-shanghai", "通知公告", { title: "上海市住建委绿色建材补贴通知", tags: ["上海补贴"], category: "industrialization" }),
      makeArticle(6, "official-shanghai", "通知公告", { title: "上海市旧房改造示范工程", tags: ["沪建旧改"], category: "industrialization" }),
    ]
    const mohurdUnapprovedColumn = [
      makeArticle(7, "official-mohurd", "未经启用测试栏目", { title: "住建部其他内部动态", tags: ["内部动态"] }),
    ]

    const allItems = [...mohurdArticles, ...unapprovedArticles, ...mohurdUnapprovedColumn]
    await publishBatch(memory.db, "test-owner", { batchId: "init_batch", baseRevision: 0, items: allItems }, [mohurdApprovedConfig])
    const state = await buildingMeta(memory.db)
    await activateBuilding(memory.db, state.total, state.revision)
    return { mohurdArticles, unapprovedArticles, mohurdUnapprovedColumn, allItems }
  }

  it("公开视图彻底排除未批准来源与未启用栏目：列表、搜索、总数、分类、标签与地点均不可见", async () => {
    const { mohurdArticles } = await seedDatabase()
    const configs = [mohurdApprovedConfig, unapprovedOtherConfig]

    const page = await readPage(memory.db, new URLSearchParams(), now, undefined, configs)
    expect(page.articles).toHaveLength(4)
    expect(page.total).toBe(4)
    expect(page.totalPublished).toBe(4)
    expect(page.articles.map(a => a.key)).toEqual(mohurdArticles.map(a => a.key))

    const searchUnapproved = await readPage(memory.db, new URLSearchParams({ q: "上海市住建委" }), now, undefined, configs)
    expect(searchUnapproved.articles).toHaveLength(0)
    expect(searchUnapproved.total).toBe(0)

    const searchMohurd = await readPage(memory.db, new URLSearchParams({ q: "绿色建筑" }), now, undefined, configs)
    expect(searchMohurd.articles).toHaveLength(1)
    expect(searchMohurd.articles[0].key).toBe(mohurdArticles[0].key)

    expect(page.facets.categories.industrialization ?? 0).toBe(0)
    expect(page.facets.categories.intelligent_construction).toBe(4)

    const tagNames = page.facets.tags.map((t: any) => t.name)
    expect(tagNames).not.toContain("上海补贴")
    expect(tagNames).not.toContain("沪建旧改")
    expect(tagNames).toContain("绿建")

    expect(page.sources).toHaveLength(1)
    expect(page.sources[0].id).toBe("official-mohurd")
  })

  it("来源停用或审批取消后立即隐藏，且旧分页 cursor 跨配置变更触发 409 拒绝", async () => {
    await seedDatabase()
    const configs = [mohurdApprovedConfig, unapprovedOtherConfig]

    const firstPage = await readPage(memory.db, new URLSearchParams({ limit: "2" }), now, undefined, configs)
    expect(firstPage.articles).toHaveLength(2)
    expect(firstPage.nextCursor).toBeTruthy()

    const secondPage = await readPage(memory.db, new URLSearchParams({ limit: "2", cursor: firstPage.nextCursor! }), now, undefined, configs)
    expect(secondPage.articles).toHaveLength(2)

    const modifiedConfigs: PublishedSourceConfig[] = [
      {
        ...mohurdApprovedConfig,
        endpoints: mohurdApprovedConfig.endpoints.map(e => e.name === "建设要闻" ? { ...e, enabled: false } : e),
      },
    ]

    await expect(
      readPage(memory.db, new URLSearchParams({ limit: "2", cursor: firstPage.nextCursor! }), now, undefined, modifiedConfigs),
    ).rejects.toMatchObject({ statusCode: 409 })

    const updatedPage = await readPage(memory.db, new URLSearchParams(), now, undefined, modifiedConfigs)
    expect(updatedPage.total).toBe(3)
    expect(updatedPage.totalPublished).toBe(3)
    expect(updatedPage.articles.some(a => a.title === "城市更新推进工作会议")).toBe(false)
  })

  it("版本接口 readVersion 返回已批准文章数，且 version 感知配置版本变动", async () => {
    await seedDatabase()
    const configs = [mohurdApprovedConfig]

    const v1 = await readVersion(memory.db, configs)
    expect(v1.totalPublished).toBe(4)
    expect(v1.version).toContain(".")

    const vEmpty = await readVersion(memory.db, [])
    expect(vEmpty.totalPublished).toBe(0)

    const vLegacy = await readVersion(memory.db)
    expect(vLegacy.totalPublished).toBe(7)
  })

  it("内部去重 knownRecords 保持全库去重，不影响未批准文章历史记录排重", async () => {
    const { allItems } = await seedDatabase()
    const keys = allItems.map(i => i.key)

    const deduplication = await knownRecords(memory.db, keys)
    expect(deduplication.records).toHaveLength(7)
  })

  it("附件读取权限严格校验：缺少 sourceId 或未批准来源一律拒绝，保留有效住建部附件", () => {
    const configs = [mohurdApprovedConfig, unapprovedOtherConfig]
    const approvedScope = extractApprovedSourceScope(configs)

    const mohurdArticle = { sourceId: "official-mohurd", column: "政策发布" }
    const unapprovedSourceArticle = { sourceId: "official-shanghai", column: "通知公告" }
    const unapprovedColumnArticle = { sourceId: "official-mohurd", column: "内部测试栏目" }
    const emptyArticle = {}

    expect(isArticlePubliclyApproved(mohurdArticle, approvedScope)).toBe(true)
    expect(isArticlePubliclyApproved(unapprovedSourceArticle, approvedScope)).toBe(false)
    expect(isArticlePubliclyApproved(unapprovedColumnArticle, approvedScope)).toBe(false)
    expect(isArticlePubliclyApproved(emptyArticle, approvedScope)).toBe(false)
  })

  it("全库106篇合成样本分批入库：准确保留34篇住建部文章，排除72篇未确认来源文章", async () => {
    const items = []
    // 34 篇住建部四栏目文章
    const columns = ["政策发布", "建设要闻", "标准公告", "标准征求意见"]
    for (let i = 0; i < 34; i++) {
      items.push(makeArticle(i + 1, "official-mohurd", columns[i % columns.length], { title: `住建部正式公告${i + 1}` }))
    }
    // 72 篇其他未批准来源文章（分布在多个不同来源）
    for (let i = 0; i < 72; i++) {
      const sourceId = i % 2 ? "official-jiangsu" : "official-beijing"
      items.push(makeArticle(i + 100, sourceId, "本地动态", { title: `地方住建动态${i + 1}`, category: "industrialization" }))
    }
    expect(items).toHaveLength(106)

    // 分批写入，每批不超过 20 篇
    let baseRevision = (await buildingMeta(memory.db)).revision
    for (let i = 0; i < items.length; i += buildingLimits.batchItems) {
      const batchItems = items.slice(i, i + buildingLimits.batchItems)
      const res = await publishBatch(memory.db, "batch-owner", { batchId: `batch_106_${i.toString().padStart(3, "0")}`, baseRevision, items: batchItems }, [mohurdApprovedConfig])
      baseRevision = res.revision
    }

    const state = await buildingMeta(memory.db)
    await activateBuilding(memory.db, state.total, state.revision)
    expect(state.total).toBe(106)

    const configs = [mohurdApprovedConfig]
    const publicPage = await readPage(memory.db, new URLSearchParams({ limit: "50" }), now, undefined, configs)

    expect(publicPage.total).toBe(34)
    expect(publicPage.totalPublished).toBe(34)
    expect(publicPage.articles).toHaveLength(34)
    expect(publicPage.articles.every(a => a.sourceId === "official-mohurd")).toBe(true)

    const versionInfo = await readVersion(memory.db, configs)
    expect(versionInfo.totalPublished).toBe(34)
  })

  it("支持大量来源配置（超过100个绑定限制场景）：json_each 单参数机制确保绝不超出D1绑定上限", async () => {
    // 构造 150 个不同来源的配置
    const massiveConfigs: PublishedSourceConfig[] = [mohurdApprovedConfig]
    for (let i = 0; i < 150; i++) {
      massiveConfigs.push({
        schemaVersion: 1,
        id: `custom-source-${i}`,
        topic: "building",
        name: `自定义来源${i}`,
        home: `https://example${i}.gov.cn/`,
        group: "地方来源",
        level: "市级",
        region: "全国",
        city: "测试",
        priority: 50,
        enabled: true,
        collectionApproved: true,
        collectionMode: "explicit",
        endpoints: [
          { id: `ep-${i}-1`, kind: "notice", name: `通知栏目${i}`, url: `https://example${i}.gov.cn/notice/`, enabled: true },
          { id: `ep-${i}-2`, kind: "policy", name: `政策栏目${i}`, url: `https://example${i}.gov.cn/policy/`, enabled: true },
        ],
      })
    }

    const { mohurdArticles } = await seedDatabase()
    // 即使存在 151 个来源、300+ 栏目，json_each 单参数机制也绝不会超过 D1 100 bind 上限
    const page = await readPage(memory.db, new URLSearchParams(), now, undefined, massiveConfigs)
    expect(page.total).toBe(4)
    expect(page.totalPublished).toBe(4)
    expect(page.articles.map(a => a.key)).toEqual(mohurdArticles.map(a => a.key))

    const versionInfo = await readVersion(memory.db, massiveConfigs)
    expect(versionInfo.totalPublished).toBe(4)
  })
})
