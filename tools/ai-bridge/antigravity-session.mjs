import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"

export const agyModel = "gemini-3.8-flash-low"
export const agyBinaryHash = "cabadc15a61944372bede1fdff186701c17467dd9d718e97dc79283055d3c101"
export const agyRoot = join(homedir(), ".gemini/antigravity-cli")
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export async function durableJson(path, value) {
  const temp = `${path}.${randomUUID()}.pending`
  const file = await open(temp, "wx", 0o600)
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temp, path)
  const directory = await open(resolve(path, ".."), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
export async function jsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"))
}
export function sessionPaths(root, id) {
  if (!uuidPattern.test(id)) throw new Error("Invalid owned AGY session ID")
  return [join(root, "conversations", `${id}.db`), ...["-wal", "-shm", "-journal"].map(s => join(root, "conversations", `${id}.db${s}`)), join(root, "brain", id), join(root, "annotations", `${id}.pbtxt`), join(root, "presence", `${id}.lock`)]
}
export async function assertPlainPath(path) {
  const absolute = resolve(path)
  const parts = absolute.split("/").filter(Boolean)
  let current = "/"
  for (const part of parts) {
    current = join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("AGY cleanup refused a symbolic link")
    } catch (error) {
      if (error.code === "ENOENT") return
      throw error
    }
  }
}
export function pidAlive(pid, group = false) {
  if (!Number.isInteger(pid) || pid < 2) return false
  try {
    process.kill(group ? -pid : pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    throw error
  }
}
export async function syncDirectory(path) {
  const directory = await open(path, "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
export async function cleanupSession(runDir, root = agyRoot) {
  await assertPlainPath(runDir)
  const config = await jsonFile(join(runDir, "config.json"))
  if (config.root !== root || resolve(config.runDir) !== resolve(runDir)) throw new Error("AGY cleanup ownership mismatch")
  if (config.parentPid !== process.pid && pidAlive(config.parentPid)) throw new Error("AGY request owner is still active")
  if (pidAlive(config.childPid, true)) throw new Error("AGY session writer is still active")
  let ledger
  try {
    ledger = await jsonFile(join(runDir, "owned.json"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (ledger) {
    if (!Number.isInteger(config.childPid) || config.childPid < 2) throw new Error("AGY writer identity was not registered")
    if (ledger.nonce !== config.nonce || config.existingIds.includes(ledger.id)) throw new Error("AGY cleanup refused an unowned conversation")
    const paths = sessionPaths(root, ledger.id)
    for (const path of paths) await assertPlainPath(path)
    for (const path of paths) await rm(path, { recursive: true, force: true })
    for (const parent of new Set(paths.map(path => resolve(path, "..")))) await syncDirectory(parent)
    // A second observation catches a live background writer recreating session files.
    await new Promise(r => setTimeout(r, 500))
    for (const path of paths) {
      try {
        await lstat(path)
        throw new Error("AGY session reappeared after cleanup")
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
    }
  }
  if (!uuidPattern.test(config.nonce)) throw new Error("Invalid AGY cleanup nonce")
  const socketPath = `/private/tmp/newsnow-agy-${config.nonce}.sock`
  await assertPlainPath(socketPath)
  await rm(socketPath, { force: true })
  await syncDirectory("/private/tmp")
  await rm(runDir, { recursive: true, force: true })
  await syncDirectory(resolve(runDir, ".."))
}
export async function recoverSessions(base, root = agyRoot) {
  await mkdir(base, { recursive: true, mode: 0o700 })
  await assertPlainPath(base)
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !uuidPattern.test(entry.name)) throw new Error("Unexpected AGY recovery entry")
    await cleanupSession(join(base, entry.name), root)
  }
}
export async function verifyAgyBinary(binary) {
  if (createHash("sha256").update(await readFile(binary)).digest("hex") !== agyBinaryHash) throw new Error("AGY binary changed; isolation must be revalidated before collection")
}
