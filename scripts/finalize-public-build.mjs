import assert from "node:assert/strict"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
const root = resolve("dist/output/public")
const snapshot = JSON.parse(await readFile("data/intelligence-snapshot.json", "utf8"))
const disabledKeys = snapshot.articles.map(article => article.key)
async function walk(path) {
  const output = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) output.push(...await walk(file))
    else if (/\.(?:m?js|json|html|map)$/.test(entry.name)) output.push(file)
  }
  return output
}
let checked = 0
for (const file of await walk(root)) {
  const text = await readFile(file, "utf8")
  assert(!disabledKeys.some(key => text.includes(key)), `Production snapshot record included in ${file}`)
  checked++
}
if (process.env.CF_PAGES) {
  // This application uses a static SPA shell; only API paths should invoke Workers.
  await writeFile(join(root, "_routes.json"), JSON.stringify({ version: 1, include: ["/api", "/api/*"], exclude: [] }))
}
console.log(JSON.stringify({ publicBuild: "pass", checkedFiles: checked, excludedTopicRecords: disabledKeys.length, routes: process.env.CF_PAGES ? "api-only" : "node-server" }))
