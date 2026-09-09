import type { IntelligenceTopic } from "./intelligence"

/** Deployment policy, never selected by URL/body/env supplied by a visitor. */
export const publicSite = Object.freeze({
  defaultTopic: "building" as IntelligenceTopic,
  enabledTopics: Object.freeze(["building"] as IntelligenceTopic[]),
  readOnly: true,
  loginEnabled: false,
  versionPollMs: 5 * 60 * 1000,
})

export function isPublishedTopic(topic: unknown): topic is IntelligenceTopic {
  return typeof topic === "string" && publicSite.enabledTopics.includes(topic as IntelligenceTopic)
}
export function isPublishedSource(source: { enabled: boolean, topic: string }) {
  return source.enabled && isPublishedTopic(source.topic)
}

/** Shared by the server gate and integration tests. Unknown APIs fail closed. */
export function publicApiAllowed(path: string, method: string): boolean {
  if (path === "/api/intelligence" || path === "/api/intelligence/version") return method === "GET" || method === "HEAD"
  return path === "/api/intelligence/attachment" && method === "POST"
}
