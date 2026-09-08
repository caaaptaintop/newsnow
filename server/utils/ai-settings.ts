import { createError, getHeader, getRequestURL, readBody, setHeader } from "h3"
import type { AIProfile, AISettingsView } from "../../shared/ai-settings"
import { normalizeProfile, createProfileAI } from "./ai-profile"

interface StoredProfile extends AIProfile { sealedKey: string }
interface StoredSettings { activeId: string, profiles: StoredProfile[] }
const table = "CREATE TABLE IF NOT EXISTS intelligence_ai_settings_v1 (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL)"
const empty: StoredSettings = { activeId: "", profiles: [] }
export function aiEnv(event: any): any { return event?.context?.cloudflare?.env ?? event?.context?.env ?? {} }
export function settingsEnabled(event: any) { return String(aiEnv(event).AI_SETTINGS_ENCRYPTION_KEY ?? "").length >= 32 }
const bytes = (value: string) => new TextEncoder().encode(value)
export async function equalSecret(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest("SHA-256", bytes(s))))
  const left = new Uint8Array(x), right = new Uint8Array(y)
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i]
  return difference === 0
}
export async function requireAIAdmin(event: any) {
  setHeader(event, "Cache-Control", "no-store")
  const expected = String(aiEnv(event).AI_ADMIN_TOKEN ?? "")
  if (expected.length < 32 || expected === String(aiEnv(event).AI_SETTINGS_ENCRYPTION_KEY ?? "") || !settingsEnabled(event)) throw createError({ statusCode: 503, message: "AI 设置未启用：须先配置 AI_ADMIN_TOKEN 和 AI_SETTINGS_ENCRYPTION_KEY 两个独立的服务端 Secret（各至少32字符）" })
  const origin = getHeader(event, "origin")
  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, message: "不允许跨站修改 AI 设置" })
  const supplied = getHeader(event, "x-ai-admin-token") ?? ""
  if (supplied.length > 512 || !await equalSecret(supplied, expected)) throw createError({ statusCode: 401, message: "AI 管理口令不正确" })
}
async function encryptionKey(secret: string) {
  if (secret.length < 32) throw new Error("未配置加密主密钥")
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", bytes(secret)), "AES-GCM", false, ["encrypt", "decrypt"])
}
const scope = (p: AIProfile) => JSON.stringify([p.id, p.kind, p.baseUrl, p.authHeader])
export async function sealKey(value: string, secret: string, profile: AIProfile) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(scope(profile)) }, await encryptionKey(secret), bytes(value))
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`
}
export async function openKey(sealed: string, secret: string, profile: AIProfile) {
  const parts = sealed.split(".")
  if (parts.length !== 2) throw new Error("密钥解密失败")
  try {
    const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(parts[0]), additionalData: bytes(scope(profile)) }, await encryptionKey(secret), decode(parts[1]))
    return new TextDecoder().decode(plain)
  } catch { throw new Error("密钥解密失败；请重新输入此配置的密钥，不能静默改用其他 AI") }
}
export async function readSettings() {
  try {
    const db = useDatabase()
    await db.prepare(table).run()
    await db.prepare("INSERT OR IGNORE INTO intelligence_ai_settings_v1 (id,revision,data) VALUES (1,0,?)").run(JSON.stringify(empty))
    const row = await db.prepare("SELECT revision,data FROM intelligence_ai_settings_v1 WHERE id=1").get() as { revision: number, data: string } | undefined
    if (!row) throw new Error("Missing settings")
    const data = JSON.parse(row.data) as StoredSettings
    if (!Array.isArray(data.profiles) || typeof data.activeId !== "string") throw new Error("Invalid settings")
    return { db, revision: row.revision, data }
  } catch { throw createError({ statusCode: 503, message: "AI 配置数据库不可用；不会以浏览器缓存或临时内存冒充持久保存" }) }
}
export function publicSettings(revision: number, data: StoredSettings): AISettingsView {
  return { revision, activeId: data.activeId, profiles: data.profiles.map(({ sealedKey, ...p }) => ({ ...p, hasKey: !!sealedKey })) }
}
export async function settingsBody(event: any) {
  if (Number(getHeader(event, "content-length") ?? 0) > 65536) throw createError({ statusCode: 413, message: "配置请求过大" })
  const body = await readBody(event)
  if (!body || JSON.stringify(body).length > 65536) throw createError({ statusCode: 400, message: "配置请求无效或过大" })
  return body
}
export async function saveSettings(event: any, input: any) {
  const current = await readSettings()
  if (!Number.isInteger(input.revision) || input.revision !== current.revision) throw createError({ statusCode: 409, message: "配置已被其他页面修改，请重新加载后再保存" })
  if (!Array.isArray(input.profiles) || input.profiles.length > 12) throw createError({ statusCode: 400, message: "最多保存12个 AI 配置" })
  const profiles: StoredProfile[] = []
  const env = aiEnv(event)
  for (const item of input.profiles) {
    let profile: AIProfile
    try { profile = normalizeProfile(item, String(env.AI_ALLOWED_HOSTS ?? "")) } catch (error: any) { throw createError({ statusCode: 400, message: error.message }) }
    if (profiles.some(p => p.id === profile.id)) throw createError({ statusCode: 400, message: "配置编号不能重复" })
    const previous = current.data.profiles.find(p => p.id === profile.id)
    const key = typeof item.apiKey === "string" ? item.apiKey.trim() : ""
    if (key.length > 4096 || /[\r\n]/.test(key)) throw createError({ statusCode: 400, message: "密钥格式无效" })
    let sealedKey = ""
    if (profile.kind !== "cloudflare") {
      if (key) sealedKey = await sealKey(key, String(env.AI_SETTINGS_ENCRYPTION_KEY), profile)
      else if (previous?.sealedKey && scope(previous) === scope(profile)) sealedKey = previous.sealedKey
      else throw createError({ statusCode: 400, message: "新配置或已更换地址/认证方式的配置必须重新填写密钥" })
    }
    profiles.push({ ...profile, sealedKey })
  }
  const activeId = typeof input.activeId === "string" ? input.activeId : ""
  if (activeId && !profiles.some(p => p.id === activeId)) throw createError({ statusCode: 400, message: "当前 AI 配置不存在" })
  const data = { activeId, profiles }
  const updated = await current.db.prepare("UPDATE intelligence_ai_settings_v1 SET revision=revision+1,data=? WHERE id=1 AND revision=? RETURNING revision")
    .get(JSON.stringify(data), current.revision) as { revision: number } | undefined
  if (!updated) throw createError({ statusCode: 409, message: "配置发生并发修改，请重新加载" })
  return publicSettings(updated.revision, data)
}
export async function savedProfileAI(event: any, id: string, data?: StoredSettings) {
  const settings = data ?? (await readSettings()).data
  const saved = settings.profiles.find(p => p.id === id)
  if (!saved) throw createError({ statusCode: 404, message: "AI 配置不存在" })
  const env = aiEnv(event)
  const profile = normalizeProfile(saved, String(env.AI_ALLOWED_HOSTS ?? ""))
  const key = profile.kind === "cloudflare" ? "" : await openKey(saved.sealedKey, String(env.AI_SETTINGS_ENCRYPTION_KEY), profile)
  return createProfileAI(profile, key, env)
}
