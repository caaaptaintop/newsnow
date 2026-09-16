import { Buffer } from "node:buffer"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  activateAgyProfile,
  agyPoolStatePath,
  agyReasonAllowsProfileSwitch,
  loadAgyProfiles,
  materializeAgyProfileToken,
  orderedAgyProfiles,
  recordAgyProfileFailure,
  recordAgyProfileSuccess,
  runWithAgyAccountPool,
  validateAgyProfiles,
} from "../tools/ai-bridge/agy-account-pool.mjs"

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

async function root() {
  const value = await mkdtemp(join(tmpdir(), "newsnow-agy-pool-"))
  temporary.push(value)
  await mkdir(join(value, ".data/mac-batch"), { recursive: true })
  return value
}

it("loads a bounded account pool from env or local config", async () => {
  const dir = await root()
  expect(await loadAgyProfiles(dir, { NEWSNOW_AGY_PROFILES: "account-b,account-a,account-b" })).toEqual(["account-b", "account-a"])
  await writeFile(join(dir, ".data/mac-batch/agy-account-pool.json"), JSON.stringify({ schemaVersion: 1, profiles: ["account-a", "account-b"] }))
  expect(await loadAgyProfiles(dir, {})).toEqual(["account-a", "account-b"])
  await expect(loadAgyProfiles(dir, { NEWSNOW_AGY_PROFILES: "bad profile" })).rejects.toThrow("invalid profile")
})

it("remembers the last successful profile without storing credentials", async () => {
  const dir = await root()
  await recordAgyProfileFailure(dir, "account-a", "authentication")
  await recordAgyProfileSuccess(dir, "account-b")
  expect(await orderedAgyProfiles(dir, ["account-a", "account-b"])).toEqual(["account-b", "account-a"])
  const state = JSON.parse(await readFile(agyPoolStatePath(dir), "utf8"))
  expect(state).toMatchObject({
    schemaVersion: 1,
    preferred: "account-b",
    lastFailure: { profile: "account-a", reason: "authentication" },
    lastSuccess: { profile: "account-b" },
  })
  expect(JSON.stringify(state)).not.toMatch(/token|cookie|authorization/i)
})

it("validates saved profiles and activates them without mutating the live keychain", async () => {
  const dir = await root()
  const calls: Array<{ file: string, args: string[] }> = []
  const run = async (file: string, args: string[]) => {
    calls.push({ file, args })
    return "_last (backup)\naccount-a\naccount-b\n"
  }
  await expect(validateAgyProfiles(dir, { profiles: ["account-a", "account-b"], run })).resolves.toEqual({ profiles: ["account-a", "account-b"] })
  await activateAgyProfile("account-b", { run })
  expect(calls).toHaveLength(2)
  expect(calls[0]?.args).toEqual(["list"])
  expect(calls[1]?.args).toEqual(["find-generic-password", "-s", "gemini-profile", "-a", "account-b"])
  await expect(validateAgyProfiles(dir, { profiles: ["missing"], run })).rejects.toThrow("profile missing")
  await expect(activateAgyProfile("account-a", { run: async () => {
    throw new Error("keychain unavailable")
  } })).rejects.toThrow("activation failed")
})

it("materializes only a per-run decoded token file with private permissions", async () => {
  const dir = await root()
  const payload = Buffer.from("{\"token\":{\"refresh_token\":\"test-only\"}}")
  const profile = Buffer.concat([
    Buffer.from("go-keyring-base64:"),
    Buffer.from(payload.toString("base64")),
    Buffer.from("\n"),
  ])
  const path = await materializeAgyProfileToken("account-b", dir, { readProfile: async () => Buffer.from(profile) })
  expect(await readFile(path)).toEqual(payload)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await expect(materializeAgyProfileToken("account-a", await root(), { readProfile: async () => Buffer.from("not-a-profile") })).rejects.toThrow("materialization failed")
})

it("switches only for account authentication or quota conditions", () => {
  expect(agyReasonAllowsProfileSwitch("authentication")).toBe(true)
  expect(agyReasonAllowsProfileSwitch("quota_or_rate_limit")).toBe(true)
  expect(agyReasonAllowsProfileSwitch("timeout")).toBe(false)
  expect(agyReasonAllowsProfileSwitch("service_or_network")).toBe(false)
})

it("fails over once on account conditions and remembers the working profile", async () => {
  const dir = await root()
  const activated: string[] = []
  const pooled = await runWithAgyAccountPool(dir, async (profile: string | undefined) => {
    if (profile === "account-b") throw new Error("AUTH")
    return "ok"
  }, {
    profiles: ["account-b", "account-a"],
    activate: async (profile: string) => {
      activated.push(profile)
    },
    classify: (error: unknown) => String((error as Error).message) === "AUTH" ? "authentication" : "unspecified",
  })
  expect(pooled).toEqual({ result: "ok", profile: "account-a" })
  expect(activated).toEqual(["account-b", "account-a"])
  expect(await orderedAgyProfiles(dir, ["account-b", "account-a"])).toEqual(["account-a", "account-b"])
})

it("does not switch accounts for ordinary service failures", async () => {
  const dir = await root()
  const activated: string[] = []
  await expect(runWithAgyAccountPool(dir, async () => {
    throw new Error("network")
  }, {
    profiles: ["account-b", "account-a"],
    activate: async (profile: string) => {
      activated.push(profile)
    },
    classify: () => "service_or_network",
  })).rejects.toThrow("network")
  expect(activated).toEqual(["account-b"])
})

it("keeps the legacy live-login path when no account pool is configured", async () => {
  const dir = await root()
  const pooled = await runWithAgyAccountPool(dir, async (profile: string | undefined) => ({ profileSeen: profile }))
  expect(pooled).toEqual({ result: { profileSeen: undefined }, profile: undefined })
})

it("serializes pooled account activation and execution", async () => {
  const dir = await root()
  const events: string[] = []
  const activate = async (profile: string) => {
    events.push(`activate:${profile}`)
  }
  const first = runWithAgyAccountPool(dir, async (profile: string | undefined) => {
    events.push(`start:${profile}`)
    await new Promise(resolve => setTimeout(resolve, 30))
    events.push(`end:${profile}`)
    return "first"
  }, { profiles: ["account-a"], activate })
  const second = runWithAgyAccountPool(dir, async (profile: string | undefined) => {
    events.push(`start:${profile}`)
    events.push(`end:${profile}`)
    return "second"
  }, { profiles: ["account-b"], activate })
  await expect(Promise.all([first, second])).resolves.toEqual([
    { result: "first", profile: "account-a" },
    { result: "second", profile: "account-b" },
  ])
  expect(events).toEqual([
    "activate:account-a",
    "start:account-a",
    "end:account-a",
    "activate:account-b",
    "start:account-b",
    "end:account-b",
  ])
})
