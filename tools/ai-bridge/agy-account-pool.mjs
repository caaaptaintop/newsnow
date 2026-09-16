import { execFile } from "node:child_process"
import { Buffer } from "node:buffer"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import process from "node:process"

import { durableJson } from "./antigravity-session.mjs"

const accountBinary = "/opt/homebrew/bin/agy-account"
const securityBinary = "/usr/bin/security"
const keyringPrefix = Buffer.from("go-keyring-base64:", "ascii")
const profilePattern = /^[a-z0-9][\w.-]{0,63}$/i
const switchableReasons = new Set(["authentication", "quota_or_rate_limit"])
let poolQueue = Promise.resolve()

function execute(file, args, options = {}) {
  return new Promise((accept, reject) => {
    execFile(file, args, { encoding: "utf8", timeout: 10000, maxBuffer: 65536, ...options }, (error, stdout) => {
      if (error) reject(error)
      else accept(stdout)
    })
  })
}

function readProfileSecret(profile) {
  return new Promise((accept, reject) => {
    execFile(securityBinary, ["find-generic-password", "-s", "gemini-profile", "-a", profile, "-w"], { encoding: "buffer", timeout: 10000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) reject(error)
      else accept(Buffer.from(stdout))
    })
  })
}

function parseProfiles(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error("AGY account pool must contain 1-4 profiles")
  const profiles = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
  if (!profiles.length || profiles.some(profile => !profilePattern.test(profile))) throw new Error("AGY account pool contains an invalid profile name")
  return profiles
}

async function json(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

export function agyPoolConfigPath(root) {
  return resolve(root, ".data/mac-batch/agy-account-pool.json")
}

export function agyPoolStatePath(root) {
  return resolve(root, ".data/mac-batch/agy-account-state.json")
}

export async function loadAgyProfiles(root, env = process.env) {
  if (env.NEWSNOW_AGY_PROFILES?.trim()) return parseProfiles(env.NEWSNOW_AGY_PROFILES.split(","))
  const config = await json(agyPoolConfigPath(root))
  if (!config) return []
  if (config.schemaVersion !== 1) throw new Error("AGY account pool schema is unsupported")
  return parseProfiles(config.profiles)
}

export async function orderedAgyProfiles(root, profiles) {
  const state = await json(agyPoolStatePath(root))
  const preferred = state?.schemaVersion === 1 && profiles.includes(state.preferred) ? state.preferred : undefined
  return preferred ? [preferred, ...profiles.filter(profile => profile !== preferred)] : [...profiles]
}

export async function validateAgyProfiles(root, options = {}) {
  const profiles = options.profiles ?? await loadAgyProfiles(root, options.env)
  if (!profiles.length) return { profiles: [] }
  const run = options.run ?? execute
  const output = await run(accountBinary, ["list"])
  const present = new Set(String(output).split(/\r?\n/).map(line => line.trim().split(/\s+/, 1)[0]).filter(Boolean))
  const missing = profiles.filter(profile => !present.has(profile))
  if (missing.length) throw new Error(`AGY account pool profile missing: ${missing.join(", ")}`)
  return { profiles }
}

export async function activateAgyProfile(profile, options = {}) {
  if (!profilePattern.test(profile)) throw new Error("AGY account profile name is invalid")
  const run = options.run ?? execute
  try {
    await run(securityBinary, ["find-generic-password", "-s", "gemini-profile", "-a", profile])
  } catch {
    throw new Error(`AGY account activation failed: ${profile}`)
  }
}

export async function materializeAgyProfileToken(profile, runDir, options = {}) {
  if (!profilePattern.test(profile)) throw new Error("AGY account profile name is invalid")
  const readProfile = options.readProfile ?? readProfileSecret
  let secret
  let decoded
  try {
    secret = await readProfile(profile)
    if (!Buffer.isBuffer(secret)) secret = Buffer.from(String(secret))
    let end = secret.length
    while (end > 0 && (secret[end - 1] === 0x0A || secret[end - 1] === 0x0D)) end -= 1
    const normalized = secret.subarray(0, end)
    if (normalized.length <= keyringPrefix.length || !normalized.subarray(0, keyringPrefix.length).equals(keyringPrefix)) throw new Error("Unexpected AGY profile format")
    decoded = Buffer.from(normalized.subarray(keyringPrefix.length).toString("ascii"), "base64")
    if (decoded.length < 2 || decoded[0] !== 0x7B || decoded[decoded.length - 1] !== 0x7D) throw new Error("Unexpected AGY token payload")
    const authDir = join(runDir, "auth")
    await mkdir(authDir, { recursive: true, mode: 0o700 })
    const path = join(authDir, "antigravity-oauth-token")
    await writeFile(path, decoded, { flag: "wx", mode: 0o600 })
    await chmod(path, 0o600)
    return path
  } catch {
    throw new Error(`AGY profile token materialization failed: ${profile}`)
  } finally {
    if (Buffer.isBuffer(secret)) secret.fill(0)
    if (Buffer.isBuffer(decoded)) decoded.fill(0)
  }
}

async function writeState(root, value) {
  const path = agyPoolStatePath(root)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await durableJson(path, { schemaVersion: 1, ...value })
}

export async function recordAgyProfileSuccess(root, profile) {
  const current = await json(agyPoolStatePath(root))
  await writeState(root, {
    preferred: profile,
    ...(current?.schemaVersion === 1 && current.lastFailure ? { lastFailure: current.lastFailure } : {}),
    lastSuccess: { profile, at: Date.now() },
  })
}

export async function recordAgyProfileFailure(root, profile, reason) {
  const current = await json(agyPoolStatePath(root))
  await writeState(root, {
    ...(current?.schemaVersion === 1 && current.preferred ? { preferred: current.preferred } : {}),
    ...(current?.schemaVersion === 1 && current.lastSuccess ? { lastSuccess: current.lastSuccess } : {}),
    lastFailure: { profile, reason, at: Date.now() },
  })
}

export function agyReasonAllowsProfileSwitch(reason) {
  return switchableReasons.has(reason)
}

export async function runWithAgyAccountPool(root, operation, options = {}) {
  const profiles = options.profiles ?? await loadAgyProfiles(root, options.env)
  if (!profiles.length) return { result: await operation(undefined), profile: undefined }
  let release
  const previous = poolQueue
  poolQueue = new Promise((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await runWithProfiles(root, profiles, operation, options)
  } finally {
    release()
  }
}

async function runWithProfiles(root, profiles, operation, options = {}) {
  const activate = options.activate ?? activateAgyProfile
  const classify = options.classify ?? (() => "unspecified")
  const rememberSuccess = options.recordSuccess ?? recordAgyProfileSuccess
  const rememberFailure = options.recordFailure ?? recordAgyProfileFailure
  const attempted = []
  for (const profile of await orderedAgyProfiles(root, profiles)) {
    try {
      await activate(profile)
      const result = await operation(profile)
      await rememberSuccess(root, profile)
      return { result, profile }
    } catch (error) {
      const reason = classify(error)
      attempted.push({ profile, reason })
      await rememberFailure(root, profile, reason)
      if (!agyReasonAllowsProfileSwitch(reason)) throw error
    }
  }
  throw new Error(`AGY account pool unavailable: ${attempted.map(item => `${item.profile}:${item.reason}`).join(",")}`)
}
