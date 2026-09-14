import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { once } from "node:events"
import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { afterEach, expect, it } from "vitest"
import { cleanupSession, durableJson, sessionPaths, sessionSocket } from "../tools/ai-bridge/antigravity-session.mjs"

const temporary: string[] = []
afterEach(async () => {
  for (const p of temporary.splice(0)) await rm(p, { recursive: true, force: true })
})
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "newsnow-agy-cleanup-")))
  temporary.push(base)
  const root = join(base, "app")
  const runDir = join(base, "runs", randomUUID())
  const id = randomUUID()
  const nonce = randomUUID()
  await mkdir(runDir, { recursive: true })
  const paths = sessionPaths(root, id)
  for (const p of paths) await mkdir(dirname(p), { recursive: true })
  await writeFile(paths[0], "synthetic body")
  await mkdir(paths[4], { recursive: true })
  await writeFile(join(paths[4], "transcript.jsonl"), "synthetic body")
  const config = { runDir, root, nonce, parentPid: process.pid, childPid: 99999999, existingIds: [] }
  await durableJson(join(runDir, "config.json"), config)
  await durableJson(join(runDir, "owned.json"), { id, nonce })
  return { base, root, runDir, id, nonce, paths, config }
}
it("cleans only the registered session and preserves unrelated conversations", async () => {
  const v = await setup()
  const other = join(v.root, "conversations", `${randomUUID()}.db`)
  await writeFile(other, "unrelated")
  await cleanupSession(v.runDir, v.root)
  await expect(readFile(v.paths[0])).rejects.toMatchObject({ code: "ENOENT" })
  await expect(readFile(join(v.runDir, "owned.json"))).rejects.toMatchObject({ code: "ENOENT" })
  expect(await readFile(other, "utf8")).toBe("unrelated")
})
it("refuses cleanup if child identity was never registered", async () => {
  const v = await setup()
  await durableJson(join(v.runDir, "config.json"), { ...v.config, childPid: null })
  await expect(cleanupSession(v.runDir, v.root)).rejects.toThrow("writer identity")
  expect(await readFile(v.paths[0], "utf8")).toBe("synthetic body")
})
it("refuses existing IDs and retains recovery metadata", async () => {
  const v = await setup()
  await durableJson(join(v.runDir, "config.json"), { ...v.config, existingIds: [v.id] })
  await expect(cleanupSession(v.runDir, v.root)).rejects.toThrow("unowned")
  expect(JSON.parse(await readFile(join(v.runDir, "owned.json"), "utf8")).id).toBe(v.id)
})
it("refuses a symbolic link before deleting any session file", async () => {
  const v = await setup()
  await rm(v.paths[0])
  const target = join(v.base, "preserve")
  await writeFile(target, "preserve")
  await symlink(target, v.paths[0])
  await expect(cleanupSession(v.runDir, v.root)).rejects.toThrow("symbolic link")
  expect(await readFile(target, "utf8")).toBe("preserve")
})

it("hook preserves Chinese characters split across socket byte boundaries", async () => {
  const v = await setup()
  await rm(join(v.runDir, "owned.json"))
  const writer = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" })
  await once(writer, "spawn")
  await durableJson(join(v.runDir, "config.json"), { ...v.config, childPid: writer.pid })
  const socketPath = sessionSocket(v.nonce)
  const original = "建筑绿色低碳与智能建造，保持完整正文。"
  const bytes = Buffer.from(original)
  const server = createServer((socket) => {
    socket.once("data", () => {
      socket.write(bytes.subarray(0, 1))
      setTimeout(() => {
        socket.write(bytes.subarray(1, 5))
        socket.end(bytes.subarray(5))
      }, 20)
    })
  })
  await new Promise<void>(accept => server.listen(socketPath, accept))
  try {
    const hook = spawn(process.execPath, ["tools/ai-bridge/antigravity-hook.mjs", "pre"], { env: { ...process.env, NEWSNOW_AGY_RUN_DIR: v.runDir }, stdio: ["pipe", "pipe", "pipe"] })
    let output = ""
    hook.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk
    })
    hook.stderr.resume()
    hook.stdin.end(JSON.stringify({ conversationId: v.id, modelName: "gemini-3.8-flash-low", workspacePaths: [v.runDir], transcriptPath: `${v.root}/brain/${v.id}/transcript.jsonl` }))
    const [code] = await once(hook, "close")
    expect(code).toBe(0)
    expect(JSON.parse(output).injectSteps[0].ephemeralMessage.endsWith(original)).toBe(true)
  } finally {
    await new Promise<void>(accept => server.close(() => accept()))
    const closed = once(writer, "close")
    writer.kill("SIGTERM")
    await closed
    await rm(socketPath, { force: true })
  }
})
