import { expect, it } from "vitest"
import { agyRuntimeEnvironment, parseMacSystemProxy } from "../tools/ai-bridge/agy-runtime-env.mjs"

const systemProxy = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}`

it("parses the enabled macOS proxy without reading shell startup files", () => {
  expect(parseMacSystemProxy(systemProxy)).toEqual({
    http: "http://127.0.0.1:7897",
    https: "http://127.0.0.1:7897",
    all: "http://127.0.0.1:7897",
  })
})

it("injects macOS system proxy variables when LaunchAgent has none", () => {
  const result = agyRuntimeEnvironment({ PATH: "/usr/bin:/bin" }, { platform: "darwin", readProxy: () => systemProxy })
  expect(result.proxySource).toBe("macos-system")
  expect(result.env).toMatchObject({
    HTTP_PROXY: "http://127.0.0.1:7897",
    HTTPS_PROXY: "http://127.0.0.1:7897",
    ALL_PROXY: "http://127.0.0.1:7897",
    http_proxy: "http://127.0.0.1:7897",
    https_proxy: "http://127.0.0.1:7897",
    all_proxy: "http://127.0.0.1:7897",
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  })
})

it("preserves an explicitly supplied proxy instead of overriding it from macOS", () => {
  const result = agyRuntimeEnvironment({ HTTPS_PROXY: "http://proxy.example:8080" }, { platform: "darwin", readProxy: () => systemProxy })
  expect(result.proxySource).toBe("environment")
  expect(result.env.HTTPS_PROXY).toBe("http://proxy.example:8080")
  expect(result.env.HTTP_PROXY).toBeUndefined()
})

it("does not invent proxy settings when the platform has none", () => {
  const result = agyRuntimeEnvironment({ PATH: "/usr/bin" }, { platform: "linux" })
  expect(result).toEqual({ env: { PATH: "/usr/bin" }, proxySource: "none" })
})
