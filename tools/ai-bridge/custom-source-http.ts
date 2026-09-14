import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib"
import { isIP } from "node:net"
import { publicAttachmentUrl } from "../../shared/attachment-preview"
import { installCustomSourceTransport } from "../../server/utils/source-http"

/** Conservatively accept global unicast only; mixed public/private answers fail closed. */
export function publicSourceAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number)
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113)
  }
  if (isIP(address) !== 6) return false
  // Excludes loopback, mapped IPv4, ULA, link-local, multicast and translation ranges.
  const [firstText, secondText] = address.split(":")
  const first = Number.parseInt(firstText, 16)
  const second = Number.parseInt(secondText || "0", 16)
  return first >= 0x2000 && first < 0x3FFF && first !== 0x2002
    && !(first === 0x2001 && (second < 0x200 || second === 0xDB8))
}
export async function publicSourceLookup(hostname: string, resolver = lookup) {
  const addresses = await resolver(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(item => !publicSourceAddress(item.address))) throw new Error("来源域名未解析到允许的公网地址")
  return addresses
}
/** No proxy, no pooled socket and no second DNS lookup: TLS still verifies the original hostname. */
export async function customSourceHttp(value: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(publicAttachmentUrl(value))
  if (init.method && init.method !== "GET") throw new Error("来源仅允许 GET 请求")
  if (init.redirect !== "manual") throw new Error("来源跳转必须逐次校验")
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    headers["accept-encoding"] = "identity"
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers,
      agent: false,
      signal: init.signal ?? undefined,
      lookup(hostname, options, callback) {
        publicSourceLookup(hostname).then((addresses) => {
          if (options.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        }, error => callback(error, "", 4))
      },
    }, (response) => {
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value)
      }
      const encoding = responseHeaders.get("content-encoding")
      if (encoding && !["identity", "gzip", "deflate", "br"].includes(encoding)) {
        response.destroy()
        reject(new Error("来源响应压缩格式不受支持"))
        return
      }
      const chunks: Uint8Array[] = []
      let length = 0
      response.on("data", (chunk: Uint8Array) => {
        length += chunk.length
        if (length > 2_000_000) response.destroy(new Error("来源响应超过采集大小上限"))
        else chunks.push(chunk)
      })
      response.on("error", reject)
      response.on("aborted", () => reject(new Error("来源响应中断")))
      response.on("end", () => {
        const data = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.length
        }
        const status = response.statusCode ?? 502
        try {
          const decompress = encoding === "gzip" ? gunzipSync : encoding === "deflate" ? inflateSync : encoding === "br" ? brotliDecompressSync : undefined
          const body = decompress ? new Uint8Array(decompress(data, { maxOutputLength: 2_000_000 })) : data
          responseHeaders.delete("content-encoding")
          responseHeaders.delete("content-length")
          resolve(new Response([204, 205, 304].includes(status) ? null : body, { status, headers: responseHeaders }))
        } catch {
          reject(new Error("来源响应解压失败或超过大小上限"))
        }
      })
    })
    request.on("error", reject)
    request.setTimeout(12_000, () => request.destroy(new Error("来源请求超时")))
    request.end()
  })
}
installCustomSourceTransport(customSourceHttp)
