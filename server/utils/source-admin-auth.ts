import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import { createError, getHeader, getRequestURL, type H3Event } from "h3"

export interface SourceAdminPrincipal { email: string }
interface AccessConfig { team: string, audience: string, allowed: Set<string> }
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
export function sourceAdminEnvironment(event: H3Event) {
  const context = event.context as Record<string, any>
  return context.cloudflare?.env ?? context.platform?.env ?? context.env ?? process.env
}
export function normalizeAccessTeamDomain(value: unknown) {
  if (typeof value !== "string") return ""
  const raw = value.trim().replace(/^https:\/\//i, "").replace(/\/+$/, "").toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(raw) ? raw : ""
}
export function sourceAdminAllowedEmails(value: unknown) {
  if (typeof value !== "string") return new Set<string>()
  const emails = value.split(/[;,\n]/).map(item => item.trim().toLowerCase()).filter(Boolean)
  if (emails.length > 20 || emails.some(email => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) return new Set<string>()
  return new Set(emails)
}
/** Key injection is a unit-test seam, never derived from a request/header/env variable. */
export async function verifySourceAdminToken(token: string, config: AccessConfig, key: JWTVerifyGetKey): Promise<SourceAdminPrincipal> {
  const { payload } = await jwtVerify(token, key, {
    audience: config.audience, issuer: `https://${config.team}`, algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "aud", "iss"], clockTolerance: 5,
  })
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
  if (!email || !config.allowed.has(email) || typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5
    || (payload.type !== undefined && payload.type !== "app")) throw new Error("Invalid Access principal")
  return { email }
}
export async function requireSourceAdmin(event: H3Event): Promise<SourceAdminPrincipal> {
  const env = sourceAdminEnvironment(event)
  const team = normalizeAccessTeamDomain(env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN)
  const audience = typeof env.SOURCE_ADMIN_ACCESS_AUD === "string" ? env.SOURCE_ADMIN_ACCESS_AUD.trim() : ""
  const allowed = sourceAdminAllowedEmails(env.SOURCE_ADMIN_EMAILS)
  if (!team || !/^[a-f0-9]{64}$/.test(audience) || !allowed.size) throw createError({ statusCode: 404, message: "Not Found" })
  const token = getHeader(event, "cf-access-jwt-assertion")
  if (!token) throw createError({ statusCode: 401, message: "Cloudflare Access authentication required" })
  if (token.length > 16_384) throw createError({ statusCode: 403, message: "Source administration access denied" })
  let remote = jwks.get(team)
  if (!remote) {
    remote = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`), { timeoutDuration: 5000 })
    if (jwks.size > 4) jwks.clear()
    jwks.set(team, remote)
  }
  try { return await verifySourceAdminToken(token, { team, audience, allowed }, remote) }
  catch { throw createError({ statusCode: 403, message: "Source administration access denied" }) }
}
export function requireSameOriginWrite(event: H3Event) {
  const origin = getHeader(event, "origin")
  if (!origin || origin !== getRequestURL(event).origin || getHeader(event, "sec-fetch-site") === "cross-site") {
    throw createError({ statusCode: 403, message: "Cross-site write rejected; Origin required" })
  }
}
