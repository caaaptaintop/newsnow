import { execFileSync } from "node:child_process"
import process from "node:process"

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]

function proxyUrl(host, port, scheme = "http") {
  if (!host || !/^\d+$/.test(String(port ?? ""))) return undefined
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
  return `${scheme}://${authority}:${port}`
}

export function parseMacSystemProxy(text) {
  const field = name => String(text).match(new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, "m"))?.[1]
  const http = field("HTTPEnable") === "1" ? proxyUrl(field("HTTPProxy"), field("HTTPPort")) : undefined
  const https = field("HTTPSEnable") === "1" ? proxyUrl(field("HTTPSProxy"), field("HTTPSPort")) : undefined
  const socks = field("SOCKSEnable") === "1" ? proxyUrl(field("SOCKSProxy"), field("SOCKSPort"), "socks5h") : undefined
  return { http, https, all: https ?? http ?? socks }
}

export function agyRuntimeEnvironment(base = process.env, options = {}) {
  const env = { ...base }
  if (proxyKeys.some(key => env[key]?.trim())) return { env, proxySource: "environment" }
  if ((options.platform ?? process.platform) !== "darwin") return { env, proxySource: "none" }
  let proxy
  try {
    const readProxy = options.readProxy ?? (() => execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 5000, maxBuffer: 65536 }))
    proxy = parseMacSystemProxy(readProxy())
  } catch {
    return { env, proxySource: "none" }
  }
  if (!proxy.http && !proxy.https && !proxy.all) return { env, proxySource: "none" }
  const noProxy = env.NO_PROXY || env.no_proxy || "127.0.0.1,localhost,::1"
  if (proxy.http) env.HTTP_PROXY = env.http_proxy = proxy.http
  if (proxy.https) env.HTTPS_PROXY = env.https_proxy = proxy.https
  if (proxy.all) env.ALL_PROXY = env.all_proxy = proxy.all
  env.NO_PROXY = env.no_proxy = noProxy
  return { env, proxySource: "macos-system" }
}
