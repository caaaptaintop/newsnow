import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { recoverSessions, verifyAgyBinary } from "./antigravity-session.mjs"

await verifyAgyBinary(join(homedir(), "Library/Application Support/CapxNewsNow/bin/agy-1.2.2"))
await recoverSessions(resolve(import.meta.dirname, "../../.data/agy-sessions"))
console.log("AGY binary verified; no pending session cleanup")
