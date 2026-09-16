import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { validateAgyProfiles } from "./agy-account-pool.mjs"
import { recoverSessions, verifyAgyBinary } from "./antigravity-session.mjs"

await verifyAgyBinary(join(homedir(), "Library/Application Support/CapxNewsNow/bin/agy-1.2.2"))
await recoverSessions(resolve(import.meta.dirname, "../../.data/agy-sessions"))
const root = resolve(import.meta.dirname, "../..")
const pool = await validateAgyProfiles(root)
console.log(`AGY binary verified; account profiles=${pool.profiles.length}; no pending session cleanup`)
