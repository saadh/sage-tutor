#!/usr/bin/env python3
"""Load data/questions.json into the Butterbase questions table. Idempotent-ish:
existing ids fail on PK conflict and are counted as skipped."""
import json, os, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = "https://api.butterbase.ai/v1/app_7m70nwelqpk6"
KEY = os.environ.get("BUTTERBASE_API_KEY") or sys.exit("BUTTERBASE_API_KEY not set")

qs = json.load(open(os.path.join(os.path.dirname(__file__), "questions.json")))
print(f"loading {len(qs)} questions…")

def post(q):
    row = {
        "qid": q["id"], "exam": q.get("exam"), "question": q["question"],
        "choices": json.dumps(q["choices"]), "correct": q["correct"], "rationale": q.get("rationale"),
        "topic": q.get("topic"), "difficulty": q.get("difficulty"),
        "hints": json.dumps(q.get("hints")), "distractor_diagnoses": json.dumps(q.get("distractor_diagnoses")),
        "solution_steps": json.dumps(q.get("solution_steps")), "verified": bool(q.get("verified")),
        "needs_review": bool(q.get("needs_review")), "source": q.get("source"),
    }
    req = urllib.request.Request(f"{BASE}/questions", data=json.dumps(row).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=30)
        return "ok"
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        return "skip" if "UNIQUE" in body or e.code == 409 else f"ERR {e.code}: {body}"
    except Exception as e:
        return f"ERR {e}"

with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(post, qs))
ok = results.count("ok"); skip = results.count("skip")
errs = [r for r in results if r.startswith("ERR")]
print(f"inserted={ok} skipped={skip} errors={len(errs)}")
for e in errs[:5]: print(" ", e)
