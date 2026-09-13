import { Buffer } from "node:buffer"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

export function backupHttpHandler(handle: (request: Request, transportDone: Promise<void>) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const abort = new AbortController()
    const transportDone = new Promise<void>((resolve) => {
      const done = () => {
        abort.abort()
        resolve()
      }
      res.once("finish", done)
      res.once("close", done)
      res.once("error", done)
    })
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
      const response = await handle(new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        signal: abort.signal,
      }), transportDone)
      if (res.destroyed) {
        await response.body?.cancel()
        return
      }
      // EOF can be prefetched while the last socket write is still blocked.
      const timer = setTimeout(() => res.destroy(new Error("Attachment delivery timed out")), 30000)
      void transportDone.then(() => clearTimeout(timer))
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res)
      else res.end()
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(503)
        res.end()
      } else {
        res.destroy()
      }
    }
  }
}
