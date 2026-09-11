/** Only bounded, allowlisted metadata survives an upstream error. No response HTML is retained. */
export interface SourceFetchDiagnostic {
  stage: "fetch"
  httpStatus: number
  category: "cloudflare_dns" | "http_530" | "access_denied" | "rate_limited" | "not_found" | "http_error"
  cloudflareCode?: string
  evidence: "header" | "body" | "status"
}
export class SourceFetchError extends Error {
  readonly diagnostic: SourceFetchDiagnostic
  constructor(message: string, diagnostic: SourceFetchDiagnostic) {
    super(message)
    this.name = "SourceFetchError"
    this.diagnostic = diagnostic
  }
}
const maxErrorBytes = 8192
async function errorPrefix(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0, prefix = ""
  // Diagnostics must not add an unbounded wait after response headers arrive.
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 1000) })
  try {
    while (size < maxErrorBytes) {
      const part = await Promise.race([reader.read(), expired])
      if (!part || part.done) break
      const bytes = part.value.subarray(0, maxErrorBytes - size)
      size += bytes.byteLength
      prefix += decoder.decode(bytes, { stream: true })
    }
    return prefix + decoder.decode()
  }
  catch { return "" }
  finally {
    clearTimeout(timeout)
    try { await reader.cancel() } catch { /* Preserve the original HTTP failure. */ }
    reader.releaseLock()
  }
}
export async function sourceFetchError(response: Response): Promise<SourceFetchError> {
  const status = response.status
  const header = response.headers.get("cf-error-type")?.trim()
  let cloudflareCode = header && /^1\d{3}$/.test(header) ? header : undefined
  let evidence: SourceFetchDiagnostic["evidence"] = cloudflareCode ? "header" : "status"
  if (status === 530 && !cloudflareCode && /^(?:text\/(?:plain|html)|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("content-type") ?? "text/plain")) {
    const prefix = await errorPrefix(response)
    // Cloudflare Worker subrequests may return only `error code: 1016`.
    // Other bodies need an explicit Cloudflare marker; never return arbitrary body text.
    const plain = prefix.trim().match(/^error code:\s*(1\d{3})$/i)
    const marked = /cloudflare/i.test(prefix) ? prefix.match(/\berror(?:\s+code)?(?:\s|<[^>]{0,120}>|:)*(1\d{3})\b/i) : null
    cloudflareCode = plain?.[1] ?? marked?.[1]
    if (cloudflareCode) evidence = "body"
  }
  else {
    try { await response.body?.cancel() } catch { /* No diagnostic body is required. */ }
  }
  const category: SourceFetchDiagnostic["category"] = status === 530
    ? cloudflareCode === "1016" ? "cloudflare_dns" : "http_530"
    : status === 429 ? "rate_limited" : [401, 403, 412].includes(status) ? "access_denied"
      : [404, 410].includes(status) ? "not_found" : "http_error"
  const code = cloudflareCode ? ` / Cloudflare ${cloudflareCode}` : ""
  const reason = category === "cloudflare_dns" ? "Cloudflare 无法解析目标主机；尚未读取栏目页，不能据此判定栏目地址错误"
    : category === "http_530" ? "目标主机解析或路由异常；尚未读取栏目页，具体原因需核对错误码"
      : category === "access_denied" ? "访问被拒绝或需要验证；未绕过限制"
        : category === "rate_limited" ? "目标站点限制请求频率；未自动重试"
          : category === "not_found" ? "请求页面不存在或已移除；请核对地址"
            : "请求失败；尚未进入文章解析"
  return new SourceFetchError(`访问目标站点收到 HTTP ${status}${code}。${reason}`, {
    stage: "fetch", httpStatus: status, category, ...(cloudflareCode ? { cloudflareCode } : {}), evidence,
  })
}
