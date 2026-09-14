import { EventEmitter } from "node:events"
import { expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }))
vi.mock("node:dns/promises", () => ({ lookup: fake.lookup }))
vi.mock("node:https", () => ({ request: fake.request }))
vi.mock("node:http", () => ({ request: fake.request }))
const { customSourceHttp, publicSourceAddress, publicSourceLookup } = await import("../tools/ai-bridge/custom-source-http")
it("rejects non-global DNS addresses including IPv4-mapped and special IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "198.18.0.1", "224.0.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "3fff::1"]) expect(publicSourceAddress(ip), ip).toBe(false)
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111", "2001:4860:4860::8888"]) expect(publicSourceAddress(ip), ip).toBe(true)
})
it("rejects mixed public/private answers and fresh rebinding answers", async () => {
  fake.lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }])
  await expect(publicSourceLookup("example.com")).rejects.toThrow("公网")
  fake.lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]).mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }])
  expect(await publicSourceLookup("example.com")).toHaveLength(1)
  await expect(publicSourceLookup("example.com")).rejects.toThrow("公网")
})
it("pins socket lookup, preserves hostname verification, and never follows redirects", async () => {
  fake.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }])
  let options: any
  fake.request.mockImplementation((url, input, callback) => {
    expect(url.hostname).toBe("example.com")
    options = input
    const request = new EventEmitter() as any
    request.setTimeout = vi.fn()
    request.end = () => {
      input.lookup(url.hostname, { all: true }, (error: Error | null, addresses: any[]) => {
        if (error) return request.emit("error", error)
        expect(addresses).toEqual([{ address: "1.1.1.1", family: 4 }])
        const response = new EventEmitter() as any
        response.headers = { location: "http://localhost/" }
        response.statusCode = 302
        callback(response)
        response.emit("end")
      })
    }
    return request
  })
  const result = await customSourceHttp("https://example.com/", { redirect: "manual" })
  expect(result.status).toBe(302)
  expect(fake.request).toHaveBeenCalledTimes(1)
  expect(options.agent).toBe(false)
  expect(options.rejectUnauthorized).not.toBe(false)
  await expect(customSourceHttp("https://example.com/", { redirect: "follow" })).rejects.toThrow()
})
it("decodes gzip with an expanded size limit", async () => {
  const { gzipSync } = await import("node:zlib")
  let payload = gzipSync("真实栏目")
  fake.request.mockImplementation((_url, _input, callback) => {
    const request = new EventEmitter() as any
    request.setTimeout = vi.fn()
    request.end = () => {
      const response = new EventEmitter() as any
      response.headers = { "content-encoding": "gzip" }
      response.statusCode = 200
      callback(response)
      response.emit("data", payload)
      response.emit("end")
    }
    return request
  })
  expect(await (await customSourceHttp("https://example.com/", { redirect: "manual" })).text()).toBe("真实栏目")
  payload = gzipSync("a".repeat(2_000_001))
  await expect(customSourceHttp("https://example.com/", { redirect: "manual" })).rejects.toThrow("大小上限")
})
