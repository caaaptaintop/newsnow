import type { IntelligenceSource } from "../../shared/intelligence"

type SourceTransport = (url: string, init: RequestInit) => Promise<Response>
let customTransport: SourceTransport | undefined
/** Installed only by the Mac runtime, never by administrator input. */
export function installCustomSourceTransport(transport: SourceTransport) {
  customTransport = transport
}
export function customSourceTransportReady() {
  return !!customTransport
}
export function sourceHttp(url: string, source: IntelligenceSource, init: RequestInit) {
  if (!source.id.startsWith("custom-")) return fetch(url, init)
  if (!customTransport) throw new Error("新增来源需由 Mac 安全网络通道测试")
  return customTransport(url, init)
}
