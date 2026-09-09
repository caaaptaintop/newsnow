/** Small, network-free reading renderer for the pinned legacy parser's structured model. */
export interface WordRun { text?: string, b?: boolean, i?: boolean, u?: boolean, strike?: boolean, size?: number, color?: number, image?: { mime: string, bytes: Uint8Array } }
export interface WordParagraph { kind: string, runs: WordRun[], align?: number, list?: { marker?: string } }
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
function runHtml(run: WordRun) {
  if (run.image && ["image/png", "image/jpeg"].includes(run.image.mime)) {
    const bytes = run.image.bytes
    if (bytes.length > 5 * 1024 * 1024) return "[嵌入图片过大，请查看原文件]"
    let binary = ""
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
    return `<img alt="文档嵌入图片" src="data:${run.image.mime};base64,${btoa(binary)}">`
  }
  const css = [run.b ? "font-weight:bold" : "", run.i ? "font-style:italic" : "", run.u || run.strike ? `text-decoration:${run.u ? "underline " : ""}${run.strike ? "line-through" : ""}` : ""]
  if (typeof run.size === "number" && Number.isFinite(run.size)) css.push(`font-size:${Math.max(8, Math.min(72, run.size))}pt`)
  if (typeof run.color === "number") css.push(`color:rgb(${run.color & 255},${(run.color >> 8) & 255},${(run.color >> 16) & 255})`)
  return `<span style="${css.filter(Boolean).join(";")}">${escape(run.text ?? "").replace(/\n/g, "<br>")}</span>`
}
export function renderWordModel(paragraphs: WordParagraph[]) {
  const result: string[] = [], rows: string[] = [], cells: string[] = []
  const flushRow = () => { if (cells.length) { rows.push(`<tr>${cells.splice(0).join("")}</tr>`) } }
  const flushTable = () => { flushRow(); if (rows.length) result.push(`<table><tbody>${rows.splice(0).join("")}</tbody></table>`) }
  for (const paragraph of paragraphs) {
    const text = (paragraph.runs ?? []).map(runHtml).join("") || "<br>"
    if (paragraph.kind === "cell" || paragraph.kind === "rowEnd") {
      cells.push(`<td>${text}</td>`)
      if (paragraph.kind === "rowEnd") flushRow()
    } else {
      flushTable()
      const align = ["left", "center", "right", "justify"][paragraph.align ?? 0] ?? "left"
      result.push(`<p style="text-align:${align};white-space:pre-wrap">${paragraph.list?.marker ? `${escape(paragraph.list.marker)} ` : ""}${text}</p>`)
    }
  }
  flushTable()
  return result.join("\n")
}
