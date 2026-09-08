import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

SOURCE_BASE = "https://news.capx-ai.com/api/s"
AB_URL = "https://news.capx-ai.com/api/topics/health/ab-test"
AB_TOKEN = "jianing-ab-20260908-v1"
PER_SOURCE = 15
SOURCES = [
    ("baidu", "百度热搜"),
    ("weibo", "微博"),
    ("zhihu", "知乎"),
    ("toutiao", "今日头条"),
    ("thepaper", "澎湃新闻"),
    ("bilibili", "哔哩哔哩"),
    ("hupu", "虎扑"),
    ("smzdm", "什么值得买"),
]
LABELS = {
    "@cf/qwen/qwen3-30b-a3b-fp8": "qwen3",
    "@cf/google/gemma-4-26b-a4b-it": "gemma4",
    "@cf/openai/gpt-oss-120b": "gpt-oss-120b",
}


def get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "newsnow-jianing-ab/4.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(url, body, timeout=180):
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "newsnow-jianing-ab/4.0"},
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    return status, round(time.time() - started, 2), json.loads(raw)


def norm(text):
    return re.sub(r"[\s，。！？、,.!?：:；;“”\"'‘’（）()【】\[\]\-]", "", str(text).lower())


candidates = []
fetch_meta = []
for source_index, (sid, sname) in enumerate(SOURCES):
    try:
        data = get_json(f"{SOURCE_BASE}?id={sid}&limit=30")
        items = data.get("items") or []
        fetch_meta.append({"source": sid, "ok": True, "count": len(items)})
        for rank, item in enumerate(items[:PER_SOURCE], start=1):
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            iid = str(item.get("id") or title)
            candidates.append({
                "key": f"{sid}:{iid}",
                "title": title,
                "source": sname,
                "rank": rank,
                "rankScore": max(0, 100 - (rank - 1) * 0.75 - source_index * 0.25),
            })
    except Exception as exc:
        fetch_meta.append({"source": sid, "ok": False, "error": repr(exc)})


dedup = {}
for item in sorted(candidates, key=lambda x: -x["rankScore"]):
    key = norm(item["title"])
    if key and key not in dedup:
        dedup[key] = item
candidates = sorted(dedup.values(), key=lambda x: -x["rankScore"])

if len(candidates) < 20:
    raise SystemExit(f"Too few live candidates: {len(candidates)}; fetch_meta={fetch_meta}")

payload_items = [
    {"key": x["key"], "title": x["title"], "source": x["source"], "rank": x["rank"]}
    for x in candidates[:100]
]
status, request_seconds, response = post_json(
    AB_URL,
    {"token": AB_TOKEN, "items": payload_items},
    timeout=180,
)
if status != 200 or not response.get("ok"):
    raise SystemExit(f"A/B endpoint failed: HTTP {status}: {json.dumps(response, ensure_ascii=False)[:4000]}")

results = {}
for result in response.get("results") or []:
    model = str(result.get("model") or "")
    label = LABELS.get(model, model)
    results[label] = result

sets = {
    label: {str(item.get("key")) for item in (result.get("items") or [])}
    for label, result in results.items()
    if result.get("ok")
}
overlap = {}
labels = list(sets)
for i in range(len(labels)):
    for j in range(i + 1, len(labels)):
        a, b = labels[i], labels[j]
        inter = sets[a] & sets[b]
        union = sets[a] | sets[b]
        overlap[f"{a}__{b}"] = {
            "intersection": len(inter),
            "union": len(union),
            "jaccard": round(len(inter) / len(union), 3) if union else 1.0,
        }

report = {
    "candidate_count": len(payload_items),
    "per_source": PER_SOURCE,
    "fetch_meta": fetch_meta,
    "request_seconds": request_seconds,
    "candidates": candidates[:100],
    "results": results,
    "overlap": overlap,
}
Path("jianing-model-ab-results.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)

title_by_key = {x["key"]: x["title"] for x in candidates}
print("===== JIANING MODEL LIVE A/B =====")
print(f"Candidates: {len(payload_items)} (top {PER_SOURCE} per source before cross-source dedupe)")
print("Fetch meta:", json.dumps(fetch_meta, ensure_ascii=False))
print(f"Whole parallel endpoint time: {request_seconds}s")
print("Pairwise overlap:", json.dumps(overlap, ensure_ascii=False))
for label, result in results.items():
    items = result.get("items") or []
    print(f"\n--- {label} | {result.get('model')} | {result.get('elapsedMs')} ms | ok={result.get('ok')} | selected {len(items)} ---")
    if not result.get("ok"):
        print("error=", result.get("error"))
        print("rawPreview=", result.get("rawPreview"))
        continue
    for idx, item in enumerate(items[:20], start=1):
        key = str(item.get("key") or "")
        print(f"{idx}. {title_by_key.get(key, key)}")
        print(f"   score={item.get('score')} main={item.get('primaryLine')} aux={item.get('auxiliaryLines')} trigger={item.get('triggers')}")
        print(f"   angle={item.get('angle')}")
        print(f"   reason={item.get('reason')}")
    print("rawPreview=", result.get("rawPreview"))
