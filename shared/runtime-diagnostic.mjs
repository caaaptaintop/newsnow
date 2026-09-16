const secretKeys = /(authorization|cookie|password|passwd|token|secret|api[-_]?key|x-building-signature|private[-_]?key)\s*[:=]\s*[^\s,;]+/gi
const sensitiveHeaders = /(proxy-authorization|authorization|set-cookie|cookie)\s*[:=][^\r\n]*/gi
const bearer = /\bBearer\s+[^\s,;]+/gi
const pem = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g
const longOpaque = /[\w+/=-]{80,}/g

function safeUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.username || url.password) {
      url.username = "redacted"
      url.password = ""
    }
    if (url.search) url.search = "?redacted"
    url.hash = ""
    return url.href
  } catch {
    return raw
  }
}

export function safeDiagnostic(value, limit = 260) {
  const redactedHeaders = String(value ?? "").replace(sensitiveHeaders, "$1=[redacted]")
  const withoutControls = [...redactedHeaders].map((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? " " : char
  }).join("")
  return withoutControls
    .replace(pem, "[redacted-key]")
    .replace(bearer, "Bearer [redacted]")
    .replace(secretKeys, "$1=[redacted]")
    .replace(/https?:\/\/\S+/gi, safeUrl)
    .replace(longOpaque, "[redacted]")
    .replace(/\/Users\/[^/\s]+\//g, "/Users/<user>/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}
