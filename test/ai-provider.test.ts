import { afterEach, describe, expect, it, vi } from "vitest"
import { configuredAI } from "../server/utils/ai-provider"
import { intelligenceClassify } from "../server/utils/intelligence-ai"

const event = (env: Record<string, unknown>) => ({ context: { cloudflare: { env } } })
const proma = () => configuredAI(event({ INTELLIGENCE_AI_PROVIDER: "proma", PROMA_API_KEY: "test-only-key", PROMA_API_PROTOCOL: "responses", PROMA_MODEL: "gpt-5.6-luna" }))
const params = { messages: [{ role: "user", content: "测试" }], max_completion_tokens: 3000 }
afterEach(() => vi.unstubAllGlobals())

describe("AI provider", () => {
  it("keeps Workers AI unless explicitly switched", async () => {
    const run = vi.fn().mockResolvedValue({ response: "ok" })
    const ai = configuredAI(event({ AI: { run }, PROMA_API_KEY: "test-only-key", PROMA_API_PROTOCOL: "responses", PROMA_MODEL: "gpt-5.6-luna" }))
    expect(ai.provider).toBe("cloudflare")
    await ai.run!(ai.model, params)
    expect(run).toHaveBeenCalledWith(ai.model, params)
  })
  it("does not silently use another model when Proma configuration is incomplete", () => {
    const ai = configuredAI(event({ INTELLIGENCE_AI_PROVIDER: "proma", AI: { run: vi.fn() } }))
    expect(ai.enabled).toBe(false)
    expect(ai.run).toBeUndefined()
    expect(configuredAI(event({ INTELLIGENCE_AI_PROVIDER: "proma", PROMA_API_KEY: "test", PROMA_BASE_URL: "http://example.com" })).enabled).toBe(false)
  })
  it("uses Responses input and parses the complete output into existing classifier decisions", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: '{"items":[{"key":"a","keep":false,"reason":"无关"}]}' }] },
    ] })))
    vi.stubGlobal("fetch", fetcher)
    const result = await intelligenceClassify(proma(), "building", [{ key: "a", title: "办公室采购", column: "通知" }])
    expect(result.get("a")?.keep).toBe(false)
    const [url, request] = fetcher.mock.calls[0]
    expect(String(url)).toBe("https://api.proma.cool/v1/responses")
    const body = JSON.parse(request.body)
    expect(body.model).toBe("gpt-5.6-luna")
    expect(body.input).toHaveLength(2)
    expect(body.messages).toBeUndefined()
    expect(body.store).toBe(false)
    expect(body.reasoning.effort).toBe("low")
    expect(request.redirect).toBe("manual")
  })
  it("uses Chat Completions for GLM with no GPT-only parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"items":[]}' } }] })))
    vi.stubGlobal("fetch", fetcher)
    const ai = configuredAI(event({ INTELLIGENCE_AI_PROVIDER: "proma", PROMA_API_KEY: "test-only-key" }))
    await ai.run!(ai.model, params)
    const [url, request] = fetcher.mock.calls[0]
    expect(String(url)).toBe("https://api.proma.cool/v1/chat/completions")
    const body = JSON.parse(request.body)
    expect(body.model).toBe("glm-5.3-flash")
    expect(body.messages).toEqual(params.messages)
    expect(body.max_tokens).toBe(3000)
    expect(body.input).toBeUndefined()
    expect(body.reasoning).toBeUndefined()
    expect(body.reasoning_effort).toBe("low")
  })
  it("supports Proma Messages and excludes thinking blocks from the answer", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: '{"items":[]}' }] })))
    vi.stubGlobal("fetch", fetcher)
    const ai = configuredAI(event({ INTELLIGENCE_AI_PROVIDER: "proma", PROMA_API_KEY: "test-only-key", PROMA_API_PROTOCOL: "messages" }))
    const result = await ai.run!(ai.model, { ...params, messages: [{ role: "system", content: "rules" }, ...params.messages] })
    expect(result.choices[0].message.content).toBe('{"items":[]}')
    const [url, request] = fetcher.mock.calls[0]
    expect(String(url)).toBe("https://api.proma.cool/v1/messages")
    expect(JSON.parse(request.body).system).toBe("rules")
    expect(JSON.parse(request.body).messages).toEqual(params.messages)
    expect(request.headers["anthropic-version"]).toBe("2023-06-01")
  })
  it("rejects redirects without forwarding the credential", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.example" } }))
    vi.stubGlobal("fetch", fetcher)
    await expect(proma().run!("ignored", params)).rejects.toThrow("HTTP 302")
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual")
  })
  it("returns only model IDs from the authenticated catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "glm-5.3-flash", internal: "hidden" }, null, { name: "invalid" }] })))
    vi.stubGlobal("fetch", fetcher)
    expect(await proma().models!()).toEqual(["glm-5.3-flash"])
    expect(String(fetcher.mock.calls[0][0])).toBe("https://api.proma.cool/v1/models")
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual")
  })
  it("sanitizes malformed model catalog responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive invalid JSON")))
    await expect(proma().models!()).rejects.toThrow("Proma 模型列表格式无效")
  })
  it("does not accept truncated output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "incomplete", output: [] }))))
    await expect(proma().run!("ignored", params)).rejects.toThrow("响应未完成")
  })
  it("does not leak upstream errors or retry a paid call", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("secret and prompt", { status: 429 }))
    vi.stubGlobal("fetch", fetcher)
    await expect(proma().run!("ignored", params)).rejects.toThrow("HTTP 429")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("reports transport errors without their sensitive contents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret transport details")))
    await expect(proma().run!("ignored", params)).rejects.toThrow("超时或连接失败")
  })
})
