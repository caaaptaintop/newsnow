import { afterEach, describe, expect, it, vi } from "vitest"

import { intelligenceFetchList } from "../server/utils/intelligence-dynamic-list"
import { intelligenceSources } from "../shared/official-sources"

const source = intelligenceSources.find(item => item.id === "official-beijing")!

function list(rows: Array<[string, string]>, next: Array<[string, string]> = []) {
  return `
    <ul>
      ${rows.map(([title, url]) => `<li><a href="${url}">${title}</a><span>2026-09-01</span></li>`).join("")}
    </ul>
    ${next.map(([label, url]) => `<a style="cursor:pointer" title="${label}" onclick="queryArticleByCondition(this,'${url}')" tagname="${url}">${label}<span>&gt;</span></a>`).join("")}`
}

function article(name: string) {
  return `/bjjs/xxgk/zcwj2024/${name}/123456789/index.shtml`
}

afterEach(() => vi.restoreAllMocks())

describe("static scripted government pagination", () => {
  it("follows multiple same-host next-page streams without executing JavaScript", async () => {
    const root = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/index.shtml"
    const a2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/a-2.shtml"
    const b2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/b-2.shtml"
    const responses = new Map([
      [root, list([
        ["北京市住房和城乡建设委员会关于第一页甲类政策事项的通知", article("a1")],
        ["北京市住房和城乡建设委员会关于第一页乙类政策事项的通知", article("b1")],
      ], [
        ["下一页", "/bjjs/zwgk46/zcwj8/a-2.shtml"],
        ["下一页", "/bjjs/zwgk46/zcwj8/b-2.shtml"],
      ])],
      [a2, list([
        ["北京市住房和城乡建设委员会关于第二页甲类政策事项的通知", article("a2")],
        ["北京市住房和城乡建设委员会关于第一页乙类政策事项的通知", article("b1")],
      ])],
      [b2, list([
        ["北京市住房和城乡建设委员会关于第一页甲类政策事项的通知", article("a1")],
        ["北京市住房和城乡建设委员会关于第二页乙类政策事项的通知", article("b2")],
      ])],
    ])
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const body = responses.get(String(input))
      return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } })
    })
    const column = { name: "政策文件", url: root }
    const page = await intelligenceFetchList(root, source, column, { maxPages: 3, shouldContinue: async () => true })

    expect(page.pages).toBe(3)
    expect(page.items.map(item => item.title)).toEqual(expect.arrayContaining([
      "北京市住房和城乡建设委员会关于第一页甲类政策事项的通知",
      "北京市住房和城乡建设委员会关于第一页乙类政策事项的通知",
      "北京市住房和城乡建设委员会关于第二页甲类政策事项的通知",
      "北京市住房和城乡建设委员会关于第二页乙类政策事项的通知",
    ]))
    expect("paginationUnverified" in page && page.paginationUnverified).toBe(false)
    expect(page.capped).toBe(false)
    expect(mock).toHaveBeenCalledTimes(3)
  })
  it("does not continue a second stream when its page has no globally novel items", async () => {
    const root = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/index.shtml"
    const a2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/a-2.shtml"
    const b2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/b-2.shtml"
    const b3 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/b-3.shtml"
    const a1Row: [string, string] = ["北京市住房和城乡建设委员会关于第一页甲类政策事项的通知", article("a1")]
    const b1Row: [string, string] = ["北京市住房和城乡建设委员会关于第一页乙类政策事项的通知", article("b1")]
    const a2Row: [string, string] = ["北京市住房和城乡建设委员会关于第二页甲类政策事项的通知", article("a2")]
    const responses = new Map([
      [root, list([a1Row, b1Row], [["下一页", "/bjjs/zwgk46/zcwj8/a-2.shtml"], ["下一页", "/bjjs/zwgk46/zcwj8/b-2.shtml"]])],
      [a2, list([a2Row, b1Row])],
      [b2, list([a2Row, a1Row], [["下一页", "/bjjs/zwgk46/zcwj8/b-3.shtml"]])],
      [b3, list([["北京市住房和城乡建设委员会关于第三页乙类政策事项的通知", article("b3")]])],
    ])
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const body = responses.get(String(input))
      return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } })
    })
    const shouldContinue = vi.fn(async (items: Array<{ title: string }>) => items.length > 0)
    const page = await intelligenceFetchList(root, source, { name: "政策文件", url: root }, { maxPages: 4, shouldContinue })

    expect(page.pages).toBe(3)
    expect(page.items.some(item => item.title.includes("第三页乙类"))).toBe(false)
    expect(page.capped).toBe(false)
    expect(mock).toHaveBeenCalledTimes(3)
    expect(shouldContinue).toHaveBeenLastCalledWith([], 3)
  })
  it("charges failed stream fetches against the hard page budget", async () => {
    const root = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/index.shtml"
    const a2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/a-2.shtml"
    const b2 = "https://zjw.beijing.gov.cn/bjjs/zwgk46/zcwj8/b-2.shtml"
    const rootBody = list([
      ["北京市住房和城乡建设委员会关于第一页甲类政策事项的通知", article("a1")],
      ["北京市住房和城乡建设委员会关于第一页乙类政策事项的通知", article("b1")],
    ], [
      ["下一页", "/bjjs/zwgk46/zcwj8/a-2.shtml"],
      ["下一页", "/bjjs/zwgk46/zcwj8/b-2.shtml"],
    ])
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url === root) return new Response(rootBody, { headers: { "content-type": "text/html" } })
      if (url === a2) return new Response("temporary failure", { status: 503 })
      if (url === b2) return new Response(list([["北京市住房和城乡建设委员会关于第二页乙类政策事项的通知", article("b2")]]), { headers: { "content-type": "text/html" } })
      return new Response("not found", { status: 404 })
    })

    const page = await intelligenceFetchList(root, source, { name: "政策文件", url: root }, { maxPages: 2, shouldContinue: async () => true })

    expect(page.pages).toBe(1)
    expect(page.capped).toBe(true)
    expect("paginationError" in page && page.paginationError).toBeTruthy()
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls.some(call => String(call[0]) === b2)).toBe(false)
  })
})
