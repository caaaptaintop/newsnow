import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it, vi } from "vitest"
import { normalizeProfile, createProfileAI } from "../server/utils/ai-profile"
import { equalSecret, sealKey, openKey, publicSettings, saveSettings, readSettings, requireAIAdmin } from "../server/utils/ai-settings"
import { configuredAI } from "../server/utils/ai-provider"

vi.mock("h3", () => ({
  createError: (input: any) => Object.assign(new Error(input.message), input),
  getHeader: (event: any, name: string) => event.headers?.[name],
  getRequestURL: () => new URL("https://news.example.com/api/intelligence/ai/settings"),
  readBody: (event: any) => event.body,
  setHeader: vi.fn(),
}))
const secret = "test-master-key-123456789012345678901234567890"
const admin = "test-admin-token-123456789012345678901234567890"
const env = { AI_SETTINGS_ENCRYPTION_KEY: secret, AI_ADMIN_TOKEN: admin }
const event = (headers: Record<string, string> = {}) => ({ context: { env }, headers })
const profile = (patch = {}) => normalizeProfile({ id: "primary", name: "Test", kind: "api", model: "model-a", baseUrl: "https://api.openai.com/v1", protocol: "responses", authHeader: "bearer", reasoning: "", timeoutSeconds: 60, ...patch })
const params = { messages: [{ role: "system", content: "rules" }, { role: "user", content: "test" }], max_completion_tokens: 3000 }
const databases: DatabaseSync[] = []
function database() { const db = new DatabaseSync(":memory:"); databases.push(db); vi.stubGlobal("useDatabase", () => db); return db }
afterEach(() => { vi.unstubAllGlobals(); databases.splice(0).forEach(db => db.close()) })

describe("AI settings", () => {
  it("requires HTTPS, an exact trusted host, and a valid root URL", () => {
    for (const url of ["http://api.openai.com/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://api.openai.com.attacker.com/v1", "https://api.openai.com/v1?key=secret", "https://user:pass@api.openai.com/v1", "https://api.openai.com/v1/responses"])
      expect(() => profile({ baseUrl: url })).toThrow()
    expect(() => profile({ timeoutSeconds: 90 })).toThrow()
    expect(normalizeProfile({ ...profile(), baseUrl: "https://node.example.com/v1" }, "node.example.com").baseUrl).toBe("https://node.example.com/v1")
  })
  it("encrypts credentials with randomized IVs and profile-bound authentication", async () => {
    const p = profile()
    const a = await sealKey("sensitive-key", secret, p), b = await sealKey("sensitive-key", secret, p)
    expect(a).not.toBe(b); expect(a).not.toContain("sensitive-key")
    expect(await openKey(a, secret, p)).toBe("sensitive-key")
    await expect(openKey(a, secret, { ...p, baseUrl: "https://api.x.ai/v1" })).rejects.toThrow("解密失败")
    await expect(openKey(a, `${secret}-wrong`, p)).rejects.toThrow("解密失败")
    expect(await equalSecret(admin, admin)).toBe(true); expect(await equalSecret(admin, "wrong")).toBe(false)
  })
  it("redacts encrypted keys from management responses", () => {
    const result = publicSettings(1, { activeId: "primary", profiles: [{ ...profile(), sealedKey: "encrypted" }] })
    expect(result.profiles[0].hasKey).toBe(true)
    expect(JSON.stringify(result)).not.toContain("encrypted")
    expect(JSON.stringify(result)).not.toContain("sealedKey")
  })
  it("requires the admin secret and rejects cross-origin writes", async () => {
    await expect(requireAIAdmin(event())).rejects.toMatchObject({ statusCode: 401 })
    await expect(requireAIAdmin(event({ "x-ai-admin-token": admin, origin: "https://evil.example" }))).rejects.toMatchObject({ statusCode: 403 })
    await expect(requireAIAdmin(event({ "x-ai-admin-token": admin, origin: "https://news.example.com" }))).resolves.toBeUndefined()
    await expect(requireAIAdmin({ context: { env: {} } })).rejects.toMatchObject({ statusCode: 503 })
  })
  it("persists ciphertext, preserves blank keys, and prevents stale overwrites", async () => {
    const db = database()
    let result = await saveSettings(event(), { revision: 0, activeId: "primary", profiles: [{ ...profile(), apiKey: "secret-api-key" }] })
    expect(result.revision).toBe(1)
    expect(JSON.stringify(db.prepare("SELECT data FROM intelligence_ai_settings_v1").get())).not.toContain("secret-api-key")
    result = await saveSettings(event(), { ...result, profiles: result.profiles.map(p => ({ ...p, model: "model-b", apiKey: "" })) })
    expect(result.revision).toBe(2)
    await expect(saveSettings(event(), { ...result, revision: 1 })).rejects.toMatchObject({ statusCode: 409 })
    await expect(saveSettings(event(), { ...result, profiles: result.profiles.map(p => ({ ...p, baseUrl: "https://api.x.ai/v1" })) })).rejects.toThrow("重新填写密钥")
  })
  it("does not pretend configuration is durable when D1 is unavailable", async () => {
    vi.stubGlobal("useDatabase", () => { throw new Error("unavailable") })
    await expect(readSettings()).rejects.toMatchObject({ statusCode: 503 })
    expect(configuredAI({ context: { aiSettingsError: true, env: { AI: { run: vi.fn() } } } }).enabled).toBe(false)
  })
  it("translates Responses without silently guessing reasoning parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] })))
    vi.stubGlobal("fetch", fetcher)
    const ai = createProfileAI(profile(), "test-key")
    expect((await ai.run!(ai.model, params)).choices[0].message.content).toBe('{"ok":true}')
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.store).toBe(false); expect(body.reasoning).toBeUndefined(); expect(body.input).toEqual(params.messages)
  })
  it("preserves the verified Messages shape without adaptive thinking", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: '{"ok":true}' }] })))
    vi.stubGlobal("fetch", fetcher)
    const ai = createProfileAI(profile({ protocol: "messages", authHeader: "x-api-key" }), "test-key")
    expect((await ai.run!(ai.model, params)).choices[0].message.content).toBe('{"ok":true}')
    const options = fetcher.mock.calls[0][1], body = JSON.parse(options.body)
    expect(body.system).toBe("rules"); expect(body.thinking).toBeUndefined(); expect(body.temperature).toBe(0)
    expect(options.headers["x-api-key"]).toBe("test-key")
  })
  it("does not retry, follow credential redirects, or expose upstream errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("secret-upstream-text", { status: 429 }))
    vi.stubGlobal("fetch", fetcher)
    const ai = createProfileAI(profile(), "test-key")
    await expect(ai.run!(ai.model, params)).rejects.toThrow("HTTP 429")
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].redirect).toBe("manual")
  })
  it("rejects incomplete Chat Completions output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "partial" } }] })) ))
    const ai = createProfileAI(profile({ protocol: "chat-completions" }), "test-key")
    await expect(ai.run!(ai.model, params)).rejects.toThrow("未完成")
  })
})

describe("health classifier integration", () => {
  async function classifier(items: any[]) {
    vi.stubGlobal("defineEventHandler", (handler: any) => handler)
    vi.stubGlobal("readBody", async () => ({ items }))
    vi.stubGlobal("logger", { error: vi.fn() })
    return (await import("../server/api/topics/health/classify.post")).default
  }
  it("does not retry newly configured paid APIs in the outer classifier", async () => {
    const handler = await classifier([{ key: "one", title: "test" }])
    const run = vi.fn().mockRejectedValue(new Error("Sanitized upstream failure"))
    const result: any = await handler({ context: { aiConfiguredRuntime: { provider: "api:primary", model: "model-a", enabled: true, run } } } as any)
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.enabled).toBe(false)
    expect(result.error).toBe("Sanitized upstream failure")
  })
  it("reports partial batches and returns provider-aware cache identity", async () => {
    const { healthTopic } = await import("../shared/topics")
    const handler = await classifier(Array.from({ length: healthTopic.aiChunkSize + 1 }, (_, i) => ({ key: `k${i}`, title: `title${i}` })))
    const run = vi.fn().mockResolvedValueOnce({ response: '{"items":[]}' }).mockRejectedValueOnce(new Error("quota"))
    const result: any = await handler({ context: { aiSettingsRevision: 3, aiConfiguredRuntime: { provider: "codex:primary", model: "model-a", enabled: true, run } } } as any)
    expect(run).toHaveBeenCalledTimes(2)
    expect(result.enabled).toBe(true)
    expect(result.error).toContain("1/2")
    expect(result.cacheKey).toBe(JSON.stringify(["codex:primary", "model-a", 3]))
  })
})
