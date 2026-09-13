import process from "node:process"
import { Buffer } from "node:buffer"
import { createServer } from "node:http"
import { createBackupHandler } from "./service"

const handle = createBackupHandler(process.env.ATTACHMENT_BACKUP_SECRET ?? "")
// Only the explicitly configured tunnel may reach this loopback service.
const server = createServer(async (req, res) => {
  let size = 0
  const chunks: Buffer[] = []
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > 8192) {
        res.writeHead(413)
        res.end()
        return
      }
      chunks.push(chunk)
    }
    const abort = new AbortController()
    res.on("close", () => abort.abort())
    const response = await handle(new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      signal: abort.signal,
    }))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    if (!res.headersSent) res.writeHead(503)
    res.end()
  }
})
server.requestTimeout = 10000
server.headersTimeout = 10000
server.listen(8792, "127.0.0.1", () => console.log("Attachment backup listening on loopback:8792"))
