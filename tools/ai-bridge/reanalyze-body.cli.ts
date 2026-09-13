import process from "node:process"
import { runReanalyzeCli } from "./reanalyze-body"

await runReanalyzeCli(process.argv.slice(2))
