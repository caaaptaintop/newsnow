import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
base = "https://news.capx-ai.com/api/s"
per_source = 15
sources = [
    ("baidu", "百度热搜"),
    ("weibo", "微博"),
    ("zhihu", "知乎"),
    ("toutiao", "今日头条"),
    ("thepaper", "澎湃新闻"),
    ("bilibili", "哔哩哔哩"),
    ("hupu", "虎扑"),
    ("smzdm", "什么值得买"),
]
models = [
    ("qwen3", "@cf/qwen/qwen3-30b-a3b-fp8"),
    ("gemma4", "@cf/google/gemma-4-26b-a4b-it"),
    ("gpt-oss-120b", "@cf/openai/gpt-oss-120b"),
]


def get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "newsnow-jianing-ab/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(s):
    return re.sub(r"[\s，。！？、,.!?：:；;“”\"'‘’（）()【】\[\]\-]", "", str(s).lower())


candidates = []
fetch_meta = []
for source_index, (sid, sname) in enumerate(sources):
    url = f"{base}?id={sid}&limit=30"
    try:
        data = get_json(url)
        items = data.get("items") or []
        fetch_meta.append({"source": sid, "ok": True, "count": len(items)})
        for rank, item in enumerate(items[:per_source], start=1):
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
    except Exception as e:
        fetch_meta.append({"source": sid, "ok": False, "error": repr(e)})


dedup = {}
for item in sorted(candidates, key=lambda x: -x["rankScore"]):
    n = norm(item["title"])
    if n and n not in dedup:
        dedup[n] = item
candidates = list(dedup.values())
candidates.sort(key=lambda x: -x["rankScore"])

if len(candidates) < 20:
    raise SystemExit(f"Too few live candidates: {len(candidates)}; fetch_meta={fetch_meta}")

system_prompt = """你是微信公众号“好看健宁练”的热点选题编辑。不要做“健康新闻分类”，而要判断一个全网热点能否一步、自然地转成普通人愿意点开、且能给出实际答案的健宁选题。

固定 8 条选题线，必须从中选 primaryLine，可再选最多 2 条 auxiliaryLines：
- public_event：公众人物/热点事件健康转化
- treatment_decision：减重药/治疗决策
- symptom_signal：身体异常/症状判别
- myth_correction：反常识/健康误区
- stress_body：生活压力×身体结果
- case_result：真实案例/结果型
- guideline_policy：指南/研究/政策→个人决策
- viral_lifestyle：爆火食品/生活方式→怎么吃、怎么做

公众人物是高权重横向触发，但不能仅因“名人”而入选。优先考虑：他正在做，我能不能学；他身上发生了什么，我需要知道什么；这个人物热点背后真正的健康问题是什么。

核心规则：
1. 娱乐、科技、体育、社会、食品等非健康热点可以入选，但必须“一步”就能自然转成健康问题。
2. 需要两层以上联想的硬蹭要排除，例如“公司裁员→焦虑→心理健康”。
3. 纯八卦、劳动纠纷、比分转会、纯商业/资本新闻、只出现医院/医生/健康等词但没有个人决策价值的内容，排除。
4. 仅凭标题明确表达的信息判断。严禁自行推测原标题没有出现的伤病、心理压力、恢复方案、饮食、训练、疾病、药物使用等事实。仅仅因为人物是运动员，不得自动转成运动健康选题。
5. 优先能转成这些问题的热点：我该怎么办；这个身体信号意味着什么；大家都说 X 真的吗；名人的做法我能不能学；热点背后的身体真相；新研究/政策出来后我要改变什么；为什么努力了还没效果；我以为健康的做法是不是错了。
6. 信息不足时，angle 用问题式表达，不要把推测写成事实。

内部 score 只用于后台排序，前端绝不展示。评分重点：选题线匹配与转化质量30、普通人切身问题20、一步自然程度15、冲突/悬念15、可形成实用答案10、事实可支撑10。原榜 rank 由系统另行参与排序，不要因为排名高就给无关内容高分。

只返回 score >= 60 的项目，最多 30 条，按 score 从高到低。triggers 最多2个，只能使用 public_figure、social_event、research_guideline、drug_product、viral_lifestyle、seasonal、online_debate、sports_event、tech_event。angle 不超过50个汉字；reason 不超过55个汉字，且不要写分数、等级或“强烈推荐”。

严格返回 JSON：{\"items\":[{\"key\":\"原key\",\"score\":88,\"primaryLine\":\"treatment_decision\",\"auxiliaryLines\":[\"myth_correction\"],\"triggers\":[\"public_figure\"],\"angle\":\"……\",\"reason\":\"……\"}]}。没有合适选题就返回 {\"items\":[]}。不要输出其他内容。"""

stable_input = sorted(
    [{"key": x["key"], "title": x["title"], "source": x["source"], "rank": x["rank"]} for x in candidates],
    key=lambda x: (x["key"], x["title"]),
)
user_prompt = "筛选以下热点候选，每行一个 JSON：\n" + "\n".join(
    json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in stable_input
)


def extract_content(payload):
    result = payload.get("result", payload) if isinstance(payload, dict) else payload
    if isinstance(result, dict):
        choices = result.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") or {}
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                return msg["content"]
        if isinstance(result.get("response"), str):
            return result["response"]
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False)


def parse_json_text(text):
    text = str(text).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a:b + 1])
        raise


def call_model(model):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    body = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_tokens": 6000,
        "stream": False,
    }
    if "qwen3" in model:
        body["seed"] = 424242
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "newsnow-jianing-ab/1.0",
        },
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp_text = r.read().decode("utf-8")
            status = r.status
    except urllib.error.HTTPError as e:
        resp_text = e.read().decode("utf-8", errors="replace")
        status = e.code
    elapsed = round(time.time() - started, 2)
    try:
        outer = json.loads(resp_text)
    except Exception:
        outer = {"raw": resp_text}
    if status != 200 or (isinstance(outer, dict) and outer.get("success") is False):
        return {"ok": False, "status": status, "seconds": elapsed, "raw": outer}
    try:
        content = extract_content(outer)
        parsed = parse_json_text(content)
        items = parsed.get("items") if isinstance(parsed, dict) else []
        if not isinstance(items, list):
            items = []
        return {
            "ok": True,
            "status": status,
            "seconds": elapsed,
            "items": items,
            "content": content,
            "raw": outer,
        }
    except Exception as e:
        return {"ok": False, "status": status, "seconds": elapsed, "parse_error": repr(e), "raw": outer}


results = {}
for label, model in models:
    print(f"\n=== Running {label}: {model} on {len(candidates)} live candidates ===", flush=True)
    results[label] = {"model": model, **call_model(model)}
    print(
        f"{label}: ok={results[label].get('ok')} seconds={results[label].get('seconds')} selected={len(results[label].get('items') or [])}",
        flush=True,
    )

title_by_key = {x["key"]: x["title"] for x in candidates}
sets = {k: {str(x.get("key")) for x in (v.get("items") or [])} for k, v in results.items() if v.get("ok")}
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
    "candidate_count": len(candidates),
    "per_source": per_source,
    "fetch_meta": fetch_meta,
    "candidates": candidates,
    "results": results,
    "overlap": overlap,
}
Path("jianing-model-ab-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

print("\n\n===== JIANING MODEL A/B SUMMARY =====")
print(f"Live candidate count: {len(candidates)} (top {per_source} per source before cross-source dedupe)")
print("Fetch meta:", json.dumps(fetch_meta, ensure_ascii=False))
print("Pairwise overlap:", json.dumps(overlap, ensure_ascii=False))
for label, result in results.items():
    print(f"\n--- {label} | {result['model']} | {result.get('seconds')}s | selected {len(result.get('items') or [])} ---")
    if not result.get("ok"):
        print(json.dumps(result, ensure_ascii=False)[:3000])
        continue
    for idx, item in enumerate((result.get("items") or [])[:20], start=1):
        key = str(item.get("key") or "")
        print(f"{idx}. {title_by_key.get(key, key)}")
        print(f"   main={item.get('primaryLine')} aux={item.get('auxiliaryLines')} trigger={item.get('triggers')}")
        print(f"   angle={item.get('angle')}")
        print(f"   reason={item.get('reason')}")
