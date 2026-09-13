import process from "node:process"
import { createServer } from "node:http"
import { createBackupHandler } from "./service"
import { backupHttpHandler } from "./http"

const handle = createBackupHandler(process.env.ATTACHMENT_BACKUP_SECRET ?? "")
// Only the explicitly configured tunnel may reach this loopback service.
const server = createServer(backupHttpHandler(handle))
server.requestTimeout = 10000
server.headersTimeout = 10000
server.listen(8792, "127.0.0.1", () => console.log("Attachment backup listening on loopback:8792"))
