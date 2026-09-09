import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import process from "node:process"

const quote = value => `'${String(value).replaceAll("'", "''")}'`
/** Update date fields only. Existing relational triggers project the correction atomically. */
export function publicationSql(snapshot) {
  if (!snapshot.articles?.length) throw new Error("Empty publication audit")
  const sql = [
    "CREATE TABLE IF NOT EXISTS intelligence_publication_backup_v1 (id TEXT PRIMARY KEY, published INTEGER, publication_date TEXT);",
    "INSERT OR IGNORE INTO intelligence_publication_backup_v1 SELECT id,published,json_extract(data,'$.publicationDate') FROM intelligence_documents_v1 WHERE json_valid(data);",
  ]
  for (const article of snapshot.articles) {
    const proof = article.publicationDate
    if (!proof || !["verified", "unknown"].includes(proof.status) || !Number.isFinite(proof.checkedAt)) throw new Error(`Missing publication evidence: ${article.key}`)
    if (proof.status === "verified" && (!Number.isFinite(article.publishedAt) || article.publishedAt <= 0)) throw new Error("Verified date missing")
    const date = proof.status === "verified" ? article.publishedAt : "NULL"
    sql.push(`UPDATE intelligence_documents_v1 SET published=${date},data=json_set(data,'$.publishedAt',${date},'$.publicationDate',json(${quote(JSON.stringify(proof))})) WHERE id=${quote(article.key)} AND json_extract(data,'$.url')=${quote(article.url)} AND COALESCE(json_extract(data,'$.publicationDate.checkedAt'),0)<${proof.checkedAt};`)
  }
  // Unmapped legacy records must never present an unverified date as publication time.
  sql.push(`UPDATE intelligence_documents_v1 SET published=NULL,data=json_set(data,'$.publishedAt',NULL,'$.publicationDate',json_object('status','unknown','reason','not_provided','url',json_extract(data,'$.url'),'checkedAt',${snapshot.generatedAt})) WHERE json_valid(data) AND json_extract(data,'$.publicationDate.status') IS NULL;`)
  sql.push("SELECT COUNT(*) AS total,SUM(published IS NOT NULL) AS dated,SUM(json_extract(data,'$.publicationDate.status')='unknown') AS unknown,SUM(published IS NOT NULL AND json_extract(data,'$.publicationDate.status')!='verified') AS invalid FROM intelligence_documents_v1;")
  return `${sql.join("\n")}\n`
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeFileSync(process.argv[3] || "publication-dates.sql", publicationSql(JSON.parse(readFileSync(process.argv[2] || "data/intelligence-snapshot.json", "utf8"))))
}
