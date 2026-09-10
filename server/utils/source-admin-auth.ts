import { createRemoteJWKSet, jwtVerify } from "jose"
import { createError, getHeader, getRequestURL, type H3Event } from "h3"

export interface SourceAdminPrincipal {
  email: string
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function sourceAdminEnvironment(event: H3Event) {
  const context = event.context as Record<string, any>
  const fallback = typeof process === "undefined" ? {} : process.env
  return context.cloudflare?.env ?? context.platform?.env ?? context.env ?? fallback
}

export function normalizeAccessTeamDomain(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return ""
  const raw = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "")
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(raw)) return ""
  return raw.toLowerCase()
}

export function sourceAdminAllowedEmails(value: unknown) {
  if (typeof value !== "string") return new Set<string>()
  return new Set(value.split(/[;,\n]/).map(item => item.trim().toLowerCase()).filter(Boolean))
}

export async function requireSourceAdmin(event: H3Event): Promise<SourceAdminPrincipal> {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test" && event.context.sourceAdminTestPrincipal) {
    return event.context.sourceAdminTestPrincipal as SourceAdminPrincipal
  }
  const env = sourceAdminEnvironment(event)
  const team = normalizeAccessTeamDomain(env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN)
  const audience = typeof env.SOURCE_ADMIN_ACCESS_AUD === "string" ? env.SOURCE_ADMIN_ACCESS_AUD.trim() : ""
  const allowed = sourceAdminAllowedEmails(env.SOURCE_ADMIN_EMAILS)
  if (!team || !audience || !allowed.size) throw createError({ statusCode: 404, statusMessage: "Not Found" })
  const token = getHeader(event, "cf-access-jwt-assertion")
  if (!token) throw createError({ statusCode: 401, statusMessage: "Cloudflare Access authentication required" })
  let remote = jwks.get(team)
  if (!remote) {
    remote = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))
    jwks.set(team, remote)
  }
  try {
    const { payload } = await jwtVerify(token, remote, { audience, issuer: `https://${team}` })
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
    if (!email || !allowed.has(email)) throw new Error("email not allowed")
    return { email }
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: "Source administration access denied" })
  }
}

export function requireSameOriginWrite(event: H3Event) {
  const origin = getHeader(event, "origin")
  if (!origin) throw createError({ statusCode: 403, statusMessage: "Origin required" })
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: "Invalid origin" })
  }
  if (originUrl.origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, statusMessage: "Cross-site write rejected" })
}
