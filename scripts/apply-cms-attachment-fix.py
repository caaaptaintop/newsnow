from pathlib import Path

p = Path('server/utils/intelligence-parser.ts')
s = p.read_text()
old = 'const attachmentExtensions = new Set(["pdf", "ofd", "doc", "docx", "docm", "wps", "rtf", "xls", "xlsx", "xlsm", "xlsb", "csv", "ppt", "pptx", "pptm", "zip", "rar", "7z", "txt"])\n'
if 'intelligenceAttachmentDiscoveryVersion' not in s:
    if old not in s: raise SystemExit('attachment extension anchor missing')
    s = s.replace(old, old + 'export const intelligenceAttachmentDiscoveryVersion = 2\n', 1)

old_load = '''function loadPage(html: string) {
  // Some government CMS pages embed static lists in XML CDATA/comments. Never execute scripts.
  const extra = [...html.matchAll(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g)].map(m => m[1]).join("\\n")
  return cheerio.load(`${html}\\n${extra}`.replace(/<!--([\\s\\S]*?)-->/g, (_match, text: string) => /<a\\s/i.test(text) ? text : ""))
}
'''
new_load = r'''function decodeStaticJsString(value: string) {
  return value.replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([\\'"nrtbfv0]))/gi, (_match, brace: string, unicode: string, hex: string, simple: string) => {
    const code = brace || unicode || hex
    if (code) {
      const value = Number.parseInt(code, 16)
      return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : ""
    }
    return ({ "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" } as Record<string, string>)[simple] ?? simple
  })
}

function staticDocumentWriteHtml(html: string) {
  // TRS-style government CMS templates can keep attachment anchors either in
  // document.write('...') itself or in a static variable such as hasFJ that is
  // later written to the page. Read string literals only; never evaluate JS.
  const fragments: string[] = []
  let total = 0
  for (const scriptMatch of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const script = scriptMatch[1]
    if (script.length > 200_000 || !/document\.write(?:ln)?\s*\(/i.test(script)) continue
    for (const pattern of [/'((?:\\.|[^'\\])*)'/g, /"((?:\\.|[^"\\])*)"/g]) {
      for (const match of script.matchAll(pattern)) {
        if (match[1].length > 80_000) continue
        const decoded = decodeStaticJsString(match[1])
        if (!/<a\b/i.test(decoded)) continue
        // attachmentExtension is designed for URLs/titles; normalize the JS
        // quote boundary before using it as a coarse prefilter. Every actual
        // href is still resolved and checked by intelligenceAllowedAttachmentUrl.
        const fileish = attachmentExtension(decoded.replace(/["']/g, " "))
        const opaque = /<a\b[^>]*href\s*=\s*["'][^"']*(?:download|attachment|file)[^"']*["'][^>]*>[\s\S]{0,240}(?:附件|下载)/i.test(decoded)
        if (!fileish && !opaque) continue
        total += decoded.length
        if (total > 100_000) return fragments.join("\n")
        fragments.push(`<div data-intelligence-static-write>${decoded}</div>`)
      }
    }
  }
  return fragments.join("\n")
}

function loadPage(html: string) {
  // Some government CMS pages embed static lists in XML CDATA/comments or in
  // static JS strings. None of these parsing paths execute page scripts.
  const extra = [...html.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => m[1]).join("\n")
  const staticWritten = staticDocumentWriteHtml(html)
  return cheerio.load(`${html}\n${extra}\n${staticWritten}`.replace(/<!--([\s\S]*?)-->/g, (_match, text: string) => /<a\s/i.test(text) ? text : ""))
}
'''
if 'function staticDocumentWriteHtml' not in s:
    if old_load not in s: raise SystemExit('loadPage anchor missing')
    s = s.replace(old_load, new_load, 1)

old_scope = '''  const foundAttachments = new Map<string, { title: string, url: string }>()
  ;(articleRoot ?? $("body")).find("a[href]").each((_index, el) => {
'''
new_scope = '''  const foundAttachments = new Map<string, { title: string, url: string }>()
  const attachmentLinks = [
    ...(articleRoot ?? $("body")).find("a[href]").toArray(),
    ...$("[data-intelligence-static-write] a[href]").toArray(),
  ]
  attachmentLinks.forEach((el) => {
'''
if 'const attachmentLinks = [' not in s:
    if old_scope not in s: raise SystemExit('attachment scope anchor missing')
    s = s.replace(old_scope, new_scope, 1)
p.write_text(s)

p = Path('test/intelligence.test.ts')
s = p.read_text()
marker = '  it("allows attachment file subdomains inside the same government site scope", () => {\n'
if 'static CMS document.write' not in s:
    test = r'''  it("extracts attachment anchors written by a static CMS document.write without executing scripts", () => {
    const njSource = { id: "official-nanjing", home: "https://sjw.nanjing.gov.cn/" } as any
    const candidate = { title: "关于南京市城市更新条例草案公开征求意见的公告", url: `${njSource.home}zmhd/dczj/202609/t20260903_5905099.html`, column: "调查征集", attachments: [] }
    const body = "南京市城乡建设委员会公开征求城市更新条例草案意见。".repeat(8)
    const html = `<div class="view TRS_UEDITOR">${body}<p>附件：1．南京市城市更新条例（草案） 2．起草说明</p></div>
      <script>window.mustNotRun = true; if("附件1.pdf<BR/>附件2.pdf" != ""){document.write('<a href="./P020260903657491913704.pdf">附件1-南京市城市更新条例（草案）》征求意见稿.pdf</a><BR/><a href="./P020260903657496859244.pdf">附件2-关于《南京市城市更新条例（草案）》（征求意见稿）起草情况的说明.pdf</a>');}</script>
      <script>document.write('<a href="https://evil.example/steal.pdf">附件3-外部文件.pdf</a>')</script>`
    const parsed = intelligenceParseArticle(html, candidate, njSource)
    expect(parsed.attachments).toEqual([
      { title: "附件1-南京市城市更新条例（草案）》征求意见稿.pdf", url: `${njSource.home}zmhd/dczj/202609/P020260903657491913704.pdf` },
      { title: "附件2-关于《南京市城市更新条例（草案）》（征求意见稿）起草情况的说明.pdf", url: `${njSource.home}zmhd/dczj/202609/P020260903657496859244.pdf` },
    ])
  })

  it("extracts attachment anchors stored in a static hasFJ variable", () => {
    const cqSource = { id: "official-chongqing", home: "https://zfcxjw.cq.gov.cn/" } as any
    const candidate = { title: "关于公布重庆市智能建造试点名单的通知", url: `${cqSource.home}zwxx_166/gsgg/202609/t20260903_16027723.html`, column: "公示公告", attachments: [] }
    const html = `<div class="TRS_Editor">${"重庆市住房城乡建设主管部门公布智能建造试点名单。".repeat(8)}</div><script>var hasFJ='<a href="./P020260903553980549840.docx">附件1：重庆市第六批智能建造试点企业名单.docx</a><BR/><a href="./P020260903553980810778.docx">附件2：重庆市第七批智能建造试点项目名单.docx</a>'; if(hasFJ!=''){var FJarr=hasFJ.split("<BR/>"); document.write('<div>附件下载：</div>'); for(var i=1;i<=FJarr.length;i++){document.write(i+"."+FJarr[i-1]+"<br/>");}}</script>`
    expect(intelligenceParseArticle(html, candidate, cqSource).attachments.map(item => item.url)).toEqual([
      `${cqSource.home}zwxx_166/gsgg/202609/P020260903553980549840.docx`,
      `${cqSource.home}zwxx_166/gsgg/202609/P020260903553980810778.docx`,
    ])
  })

  it("does not interpret dynamic JavaScript as attachment markup", () => {
    const candidate = { title: article.title, url: article.url, column: "通知公告", attachments: [] }
    const html = `<div class="TRS_Editor">${"深圳市发布智能建造试点项目通知。".repeat(10)}</div><script>const p='/file.pdf'; document.write('<a href="' + p + '">附件下载</a>')</script>`
    expect(intelligenceParseArticle(html, candidate, source).attachments).toEqual([])
  })

'''
    if marker not in s: raise SystemExit('test insertion anchor missing')
    s = s.replace(marker, test + marker, 1)
p.write_text(s)

p = Path('tools/ai-bridge/backfill-attachments.ts')
s = p.read_text()
old = 'import { enrichOfficialArticleMetadata } from "./enrich-article"\n'
if 'intelligenceAttachmentDiscoveryVersion' not in s:
    if old not in s: raise SystemExit('backfill import anchor missing')
    s = s.replace(old, old + 'import { intelligenceAttachmentDiscoveryVersion } from "../../server/utils/intelligence-parser"\n', 1)
old_filter = '''  .filter((article: any) => {
    if (!sources.has(article.sourceId) || (article.attachments?.length ?? 0) > 0 || ledger.checked[article.key]) return false
    return (ledger.failures[article.key]?.attempts ?? 0) < 3
  })
'''
new_filter = '''  .filter((article: any) => {
    const checked = ledger.checked[article.key]
    const currentCheck = checked && Number(checked.discoveryVersion ?? 1) >= intelligenceAttachmentDiscoveryVersion
    if (!sources.has(article.sourceId) || (article.attachments?.length ?? 0) > 0 || currentCheck) return false
    return (ledger.failures[article.key]?.attempts ?? 0) < 3
  })
'''
if 'const currentCheck = checked' not in s:
    if old_filter not in s: raise SystemExit('backfill filter anchor missing')
    s = s.replace(old_filter, new_filter, 1)
old_ledger = 'ledger.checked[article.key] = { at: Date.now(), attachments: metadata.attachments.length }'
if 'discoveryVersion: intelligenceAttachmentDiscoveryVersion' not in s:
    if old_ledger not in s: raise SystemExit('backfill ledger anchor missing')
    s = s.replace(old_ledger, 'ledger.checked[article.key] = { at: Date.now(), attachments: metadata.attachments.length, discoveryVersion: intelligenceAttachmentDiscoveryVersion }', 1)
p.write_text(s)
