export type AIKind = "api" | "codex" | "grok-subscription" | "cloudflare"
export type AIProtocol = "chat-completions" | "responses" | "messages"
export interface AIProfile {
  id: string
  name: string
  kind: AIKind
  model: string
  baseUrl: string
  protocol: AIProtocol
  authHeader: "bearer" | "x-api-key"
  reasoning: "" | "low" | "medium" | "high"
  timeoutSeconds: number
}
export interface AIPublicProfile extends AIProfile { hasKey: boolean }
export interface AISettingsView { revision: number, activeId: string, profiles: AIPublicProfile[] }
export const aiPresets: { name: string, kind: AIKind, baseUrl: string, protocol: AIProtocol, authHeader?: "x-api-key", model?: string }[] = [
  { name: "ChatGPT 订阅 · Codex 节点", kind: "codex", baseUrl: "", protocol: "chat-completions" },
  { name: "Grok 订阅 · OpenCode 节点", kind: "grok-subscription", baseUrl: "", protocol: "chat-completions" },
  { name: "OpenAI API", kind: "api", baseUrl: "https://api.openai.com/v1", protocol: "responses" },
  { name: "Grok API · 独立计费", kind: "api", baseUrl: "https://api.x.ai/v1", protocol: "chat-completions" },
  { name: "Proma · GLM Messages", kind: "api", baseUrl: "https://api.proma.cool/v1", protocol: "messages", model: "glm-5.3-flash" },
  { name: "DeepSeek API", kind: "api", baseUrl: "https://api.deepseek.com/v1", protocol: "chat-completions" },
  { name: "Anthropic API", kind: "api", baseUrl: "https://api.anthropic.com/v1", protocol: "messages", authHeader: "x-api-key" },
  { name: "其他兼容 API / 自建网关", kind: "api", baseUrl: "", protocol: "chat-completions" },
  { name: "Cloudflare Workers AI", kind: "cloudflare", baseUrl: "", protocol: "chat-completions" },
]
