import { createError, getHeader } from "h3"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { buildingEnv } from "../building/store"

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function requireSourceAdmin(event: any) {
  const env = buildingEnv(event)
  const rawDomain = typeof env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN === "string" ? env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN.trim() : ""
  const domain = rawDomain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase()
  const audience = typeof env.SOURCE_ADMIN_ACCESS_AUD === "string" ? env.SOURCE_ADMIN_ACCESS_AUD.trim() : ""
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(domain) || !audience) {
    throw createError({ statusCode: 404, message: "信息源管理中心尚未配置访问保护" })
  }
  const token = getHeader(event, "cf-access-jwt-assertion") ?? ""
  if (!token) throw createError({ statusCode: 401, message: "需要通过受保护的管理入口访问" })
  try {
    let jwks = keySets.get(domain)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`))
      keySets.set(domain, jwks)
    }
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${domain}`, audience })
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    const allowed = typeof env.SOURCE_ADMIN_ALLOWED_EMAILS === "string"
      ? env.SOURCE_ADMIN_ALLOWED_EMAILS.split(",").map((item: string) => item.trim().toLowerCase()).filter(Boolean)
      : []
    if (allowed.length && (!email || !allowed.includes(email))) throw createError({ statusCode: 403, message: "当前账号没有信息源管理权限" })
    return { actor: email || String(payload.sub || "cloudflare-access"), email }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 401, message: "管理身份验证失败" })
  }
}
