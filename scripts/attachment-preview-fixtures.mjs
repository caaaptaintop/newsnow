// Synthetic in-memory fixtures only. No government attachment is downloaded or retained by tests.
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
export const readDoc = require("legacy-word-reader")
const writeDoc = require("legacy-word-reader/src/textToDoc.js")

function crc32(bytes) {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
export function storedZip(files) {
  const local = [], central = []
  let offset = 0
  for (const [filename, text] of Object.entries(files)) {
    const name = Buffer.from(filename), data = Buffer.from(text), crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034B50, 0); header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014B50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42)
    central.push(entry, name); offset += header.length + name.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(files).length
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
function samplePdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (Attachment preview test) Tj ET"
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let pdf = "%PDF-1.4\n", offsets = [0]
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${value}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
export function makeFixtures() {
  const doc = Buffer.from(writeDoc([
    { runs: [{ text: "智能建造附件预览", b: true, size: 32 }], kind: "p" },
    { runs: [{ text: "这是中文 DOC 二进制测试，不是 DOCX。" }], kind: "p" },
    { runs: [{ text: "项目名称" }], kind: "cell" },
    { runs: [{ text: "测试工程" }], kind: "rowEnd" },
  ]))
  const docx = storedZip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>智能建造 DOCX 预览测试</w:t></w:r></w:p><w:p><w:r><w:t>申报说明：仅用于自动测试。</w:t></w:r></w:p></w:body></w:document>',
  })
  const html = Buffer.from('<html xmlns:w="urn:schemas-microsoft-com:office:word"><body><h1>HTML 格式 Word 测试</h1><script>parent.hacked=1</script><img src="https://leak.example.com/pixel"><style>@import "https://leak.example.com/style";p{background:url(https://leak.example.com/css)}</style><p onclick="alert(1)">不应产生外部请求</p></body></html>')
  return {
    doc: { filename: "申报表.doc", mime: "application/msword", bytes: doc },
    docx: { filename: "申报说明.docx", mime: "application/octet-stream", bytes: docx },
    pdf: { filename: "测试.pdf", mime: "application/pdf", bytes: samplePdf() },
    text: { filename: "说明.txt", mime: "text/plain", bytes: Buffer.from("中文文本预览\n<script>不得执行</script>") },
    html: { filename: "旧网页格式.doc", mime: "application/msword", bytes: html },
    bad: { filename: "错误.doc", mime: "text/html", bytes: Buffer.from("<html>登录验证</html>") },
    rtf: { filename: "伪装格式.doc", mime: "application/msword", bytes: Buffer.from("{\\rtf1 unsupported}") },
    image: { filename: "示例.png", mime: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKjUAAAAASUVORK5CYII=", "base64") },
  }
}
export function asArrayBuffer(bytes) {
  return Uint8Array.from(bytes).buffer
}
