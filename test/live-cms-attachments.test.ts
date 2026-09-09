import { describe, expect, it } from "vitest"
import { intelligenceFetchHtml, intelligenceParseArticle } from "../server/utils/intelligence-parser"

const cases = [
  ["https://sjw.nanjing.gov.cn/zmhd/dczj/202609/t20260903_5905099.html", 2],
  ["https://sjw.nanjing.gov.cn/tzgg/202609/t20260902_5904391.html", 3],
  ["https://jst.nx.gov.cn/zwfw/gsgg/202609/t20260902_5329305.html", 1],
  ["https://jst.nx.gov.cn/zwgk/zcwjk/gfxwj/202605/t20260522_5247080.html", 1],
  ["https://zfcxjw.cq.gov.cn/zwxx_166/gsgg/202609/t20260903_16027723.html", 2],
] as const

describe("live government CMS attachment extraction", () => {
  for (const [url, expected] of cases) {
    it(url, async () => {
      const parsedUrl = new URL(url)
      const source = { id: `live-${parsedUrl.hostname}`, home: `${parsedUrl.protocol}//${parsedUrl.hostname}/` } as any
      const fetched = await intelligenceFetchHtml(url, source)
      const article = intelligenceParseArticle(fetched.html, { title: "附件抓取实时验证页面", url: fetched.url, column: "验证", attachments: [] }, source)
      console.log(JSON.stringify({ url, attachments: article.attachments }, null, 2))
      expect(article.attachments).toHaveLength(expected)
    }, 20_000)
  }
})
