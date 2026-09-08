import json
import time
import urllib.error
import urllib.request
from pathlib import Path

AB_URL = "https://news.capx-ai.com/api/topics/health/ab-test"
AB_TOKEN = "jianing-ab-20260908-v1"
LABELS = {
    "@cf/qwen/qwen3-30b-a3b-fp8": "qwen3",
    "@cf/google/gemma-4-26b-a4b-it": "gemma4",
    "@cf/openai/gpt-oss-120b": "gpt-oss-120b",
}

# 15 条应入选 + 15 条应排除。正例覆盖健宁历史高表现母题，负例覆盖此前实际出现的硬蹭误判。
CASES = [
    ("p01", "ChatGPT创始人吃二甲双胍抗衰老，真的有效？", True),
    ("p02", "浙江104岁老人每天睡觉18个小时", True),
    ("p03", "一饿就心慌手抖，是低血糖还是心脏问题？", True),
    ("p04", "GLP-1用药指南刚发布，这5类人千万别乱打", True),
    ("p05", "黄渤回应‘家门口骑车锁骨骨折’", True),
    ("p06", "准时准点的睡眠真的那么重要吗？", True),
    ("p07", "替尔泊肽瘦下来后，我用这3个‘懒人吃法’稳了1年没反弹", True),
    ("p08", "普通人降低皮质醇最快的方法，不是睡觉", True),
    ("p09", "老公打呼噜吵了我10年，他去做了这件事", True),
    ("p10", "某明星一个月暴瘦15斤", True),
    ("p11", "Apple Watch新增睡眠呼吸暂停提醒功能", True),
    ("p12", "某网红饮料突然爆火，宣称零糖更适合减脂", True),
    ("p13", "新版高血压指南发布，家庭血压目标值有调整", True),
    ("p14", "白露后饮食起居皆有章法", True),
    ("p15", "至今不懂刘翔跟腱断裂、周琦吃鸡蛋灌饼这种事的黑点到底在哪", True),
    ("n01", "郑钦文逆转震惊美网", False),
    ("n02", "郑钦文让5追7时隔两年重返美网8强", False),
    ("n03", "刘亦菲脸比珠宝还闪", False),
    ("n04", "iPhone Ultra没有消除屏幕折痕，国行或14999元起", False),
    ("n05", "星宇股份发布近期调岗减员错误行为的相关情况及整改措施", False),
    ("n06", "贫困生花几千元赴香港看演唱会惹争议", False),
    ("n07", "男子偷拍未公开战机刚发布就被查", False),
    ("n08", "小米澎程N70系列增程SUV发布，售价20.99万元起", False),
    ("n09", "联合国发布了新版世界地图", False),
    ("n10", "上海深入推进出租车抛客甩客专项整治", False),
    ("n11", "郭德纲歪曲篡改抗战歌曲，武汉文旅局发布处理通报", False),
    ("n12", "华为时隔六年再次发布高性能芯片", False),
    ("n13", "脱离遥控器，人形机器人全自主格斗", False),
    ("n14", "5岁女孩病历被标注‘刁蛮’，涉事医生被立案调查", False),
    ("n15", "被父母花高价送进矫正机构，这类针对‘问题成年人’的特训学校是否有存在价值？", False),
]


def post_json(url, body, timeout=180):
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "newsnow-jianing-ab/3.0"},
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


payload_items = [
    {"key": key, "title": title, "source": "control", "rank": i + 1}
    for i, (key, title, _) in enumerate(CASES)
]
expected_positive = {key for key, _, expected in CASES if expected}
expected_negative = {key for key, _, expected in CASES if not expected}
title_by_key = {key: title for key, title, _ in CASES}

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
    selected = {str(item.get("key")) for item in (result.get("items") or [])}
    tp = len(selected & expected_positive)
    fp = len(selected & expected_negative) + len(selected - expected_positive - expected_negative)
    fn = len(expected_positive - selected)
    tn = len(expected_negative - selected)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    result["metrics"] = {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "false_positive_keys": sorted(selected & expected_negative),
        "missed_positive_keys": sorted(expected_positive - selected),
    }
    results[label] = result

report = {
    "candidate_count": len(payload_items),
    "request_seconds": request_seconds,
    "cases": [
        {"key": key, "title": title, "expected": expected}
        for key, title, expected in CASES
    ],
    "results": results,
}
Path("jianing-model-ab-results.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)

print("===== JIANING MODEL CONTROL-SET A/B =====")
print(f"Cases: {len(CASES)} = {len(expected_positive)} positive + {len(expected_negative)} negative")
print(f"Whole parallel endpoint time: {request_seconds}s")
for label, result in results.items():
    items = result.get("items") or []
    m = result.get("metrics") or {}
    print(f"\n--- {label} | {result.get('model')} | {result.get('elapsedMs')} ms | ok={result.get('ok')} | selected {len(items)} ---")
    print("metrics=", json.dumps(m, ensure_ascii=False))
    if not result.get("ok"):
        print("error=", result.get("error"))
        print("rawPreview=", result.get("rawPreview"))
        continue
    for idx, item in enumerate(items, start=1):
        key = str(item.get("key") or "")
        expected = key in expected_positive
        print(f"{idx}. [{key}] expected={expected} {title_by_key.get(key, key)}")
        print(f"   score={item.get('score')} main={item.get('primaryLine')} aux={item.get('auxiliaryLines')} trigger={item.get('triggers')}")
        print(f"   angle={item.get('angle')}")
        print(f"   reason={item.get('reason')}")
    print("rawPreview=", result.get("rawPreview"))
