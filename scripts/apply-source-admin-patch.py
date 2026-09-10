from pathlib import Path
import re

root = Path.cwd()


def replace(path: str, old: str, new: str, count: int = 1):
    file = root / path
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:100]}")
    file.write_text(text.replace(old, new, count), encoding="utf-8")


# The reusable collector is now the single implementation. Explicitly managed
# sources never auto-discover or fall back to their home page.
(root / "tools/ai-bridge/collect-source.ts").write_text(
    'export { collectSource } from "../../server/utils/intelligence-collector"\n',
    encoding="utf-8",
)

# Add source configuration tables, use the effective published registry for
# server-side source validation, and keep a health rollup for the management UI.
store = root / "server/building/store.ts"
text = store.read_text(encoding="utf-8")
if "sourceAdminSchema" not in text:
    marker = 'import { isPublishedSource } from "../../shared/public-site"'
    if marker not in text:
        raise RuntimeError("building store public-site import changed")
    text = text.replace(
        marker,
        marker + '\nimport { sourceAdminSchema } from "../source-admin/schema"\nimport { sourceConfigSnapshot } from "../source-admin/store"',
        1,
    )
    marker = "export const buildingSchema = ["
    if marker not in text:
        raise RuntimeError("building schema declaration changed")
    text = text.replace(marker, marker + "\n  ...sourceAdminSchema,", 1)

old_allowed = "const allowed=new Set(intelligenceSources.filter(isPublishedSource).map(s=>s.id))"
if old_allowed not in text:
    raise RuntimeError("building source allowlist changed")
text = text.replace(
    old_allowed,
    'const configured=await sourceConfigSnapshot(db,"building")\n  const allowed=new Set(configured.sources.filter(isPublishedSource).map(source=>source.id))',
    1,
)

old_health = 'else statements.push(db.prepare(`INSERT INTO building_sources_v3 VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at WHERE excluded.checked_at>=building_sources_v3.checked_at`).bind(i.key,JSON.stringify(d),d.checkedAt))'
if old_health not in text:
    raise RuntimeError("building source state statement changed")
new_health = '''else {
      statements.push(db.prepare(`INSERT INTO building_sources_v3 VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at WHERE excluded.checked_at>=building_sources_v3.checked_at`).bind(i.key,JSON.stringify(d),d.checkedAt))
      statements.push(db.prepare(`INSERT INTO source_health_rollup_v1(source_id,topic,status,checked_at,last_success_at,last_error_at,consecutive_failures,data)
        VALUES(?,?,?, ?,CASE WHEN ? IN ('ok','partial') THEN ? ELSE NULL END,CASE WHEN ?='error' THEN ? ELSE NULL END,CASE WHEN ?='error' THEN 1 ELSE 0 END,?)
        ON CONFLICT(source_id) DO UPDATE SET topic=excluded.topic,status=excluded.status,checked_at=excluded.checked_at,
        last_success_at=CASE WHEN excluded.status IN ('ok','partial') THEN excluded.checked_at ELSE source_health_rollup_v1.last_success_at END,
        last_error_at=CASE WHEN excluded.status='error' THEN excluded.checked_at ELSE source_health_rollup_v1.last_error_at END,
        consecutive_failures=CASE WHEN excluded.status='error' THEN source_health_rollup_v1.consecutive_failures+1 ELSE 0 END,data=excluded.data
        WHERE excluded.checked_at>=source_health_rollup_v1.checked_at`).bind(i.key,"building",d.status,d.checkedAt,d.status,d.checkedAt,d.status,d.checkedAt,d.status,JSON.stringify(d)))
    }'''
text = text.replace(old_health, new_health, 1)
store.write_text(text, encoding="utf-8")

# Allow the published read-only source snapshot and the Access-protected admin API.
replace(
    "shared/public-site.ts",
    'if (path === "/api/intelligence" || path === "/api/intelligence/version") return method === "GET" || method === "HEAD"',
    'if (path === "/api/intelligence" || path === "/api/intelligence/version" || path === "/api/intelligence/source-config") return method === "GET" || method === "HEAD"',
)
replace(
    "server/middleware/00-public-site.ts",
    'publicApiAllowed(path, event.method) || (path === "/api/internal/building" && event.method === "POST")',
    'publicApiAllowed(path, event.method) || (path === "/api/internal/building" && event.method === "POST") || (path === "/api/internal/source-admin" && ["GET","POST"].includes(event.method))',
)

# Mac collection fetches the published configuration once per batch. The later
# merge/backfill processes read the verified local metadata cache.
source_import = re.compile(r'import\s*\{\s*intelligenceSources\s*\}\s*from\s*["\']\.\./\.\./shared/official-sources["\']\s*\n')


def insert_after_imports(text: str, declaration: str):
    lines = text.splitlines()
    import_lines = [index for index, line in enumerate(lines) if line.startswith("import ")]
    if not import_lines:
        raise RuntimeError("no imports found")
    lines.insert(max(import_lines) + 1, declaration)
    return "\n".join(lines) + "\n"


mac_batch = root / "tools/ai-bridge/mac-batch.ts"
text = mac_batch.read_text(encoding="utf-8")
if not source_import.search(text):
    raise RuntimeError("mac-batch source import changed")
text = source_import.sub('import { fetchRuntimeIntelligenceSources } from "./source-config-runtime"\n', text, count=1)
text = insert_after_imports(text, "const intelligenceSources = await fetchRuntimeIntelligenceSources()")
mac_batch.write_text(text, encoding="utf-8")

for file in (root / "tools/ai-bridge").glob("*.ts"):
    relative = file.relative_to(root).as_posix()
    if relative in {"tools/ai-bridge/mac-batch.ts", "tools/ai-bridge/source-config-runtime.ts", "tools/ai-bridge/collect-source.ts"}:
        continue
    text = file.read_text(encoding="utf-8")
    if not source_import.search(text):
        continue
    text = source_import.sub('import { readCachedRuntimeIntelligenceSources } from "./source-config-runtime"\n', text, count=1)
    text = insert_after_imports(text, "const intelligenceSources = readCachedRuntimeIntelligenceSources()")
    file.write_text(text, encoding="utf-8")

# Long-term rules: public visitors still have no admin; an Access-protected
# operator-only source center is explicitly allowed.
agents = root / "AGENTS.md"
text = agents.read_text(encoding="utf-8")
needle = "- 当前不开放用户登录、授权管理后台和访客 AI 设置入口；"
if needle in text and "允许使用 Cloudflare Access 保护的内部运营信息源管理中心" not in text:
    text = text.replace(needle, needle + "\n- 允许使用 Cloudflare Access 保护的内部运营信息源管理中心；该入口不是访客后台，不得公开或复用为访客登录；", 1)
agents.write_text(text, encoding="utf-8")

instructions = root / "docs/CHATGPT-PROJECT-INSTRUCTIONS.md"
text = instructions.read_text(encoding="utf-8")
needle = "- 不开放访客登录、授权管理后台和访客 AI 设置；"
if needle in text and "可建设仅由 Cloudflare Access 保护的内部信息源管理中心" not in text:
    text = text.replace(needle, needle + "\n- 可建设仅由 Cloudflare Access 保护的内部信息源管理中心，但不得变成访客后台；", 1)
instructions.write_text(text, encoding="utf-8")
