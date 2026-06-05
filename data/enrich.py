"""
AQuA-RAT enrichment script — tags each question with topic + difficulty (1-5).

At the hackathon this logic becomes a RocketRide pipeline; the LLM call goes
through the Butterbase AI Model Gateway (it's OpenAI-compatible, so only
BASE_URL / API_KEY / MODEL change). Until then it runs standalone with any
OpenAI-compatible endpoint so the data layer can be prepared in advance.

Usage:
    export LLM_BASE_URL=...   # Butterbase gateway URL at the hackathon
    export LLM_API_KEY=...
    export LLM_MODEL=claude-sonnet-4-6   # any model the gateway serves
    python3 enrich.py test.json dev.json   # -> questions.json
"""
import json, os, re, sys, urllib.request

BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.anthropic.com/v1")
API_KEY = os.environ.get("LLM_API_KEY", "")
MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-4-6")
BATCH = 10  # questions per LLM call

RUBRIC = """You are a GMAT quantitative tutor classifying questions.
For EACH question, assign:
- topic: one of [arithmetic, percentages, profit-and-loss, interest,
  ratio-and-proportion, speed-time-distance, work-and-rates, probability,
  combinatorics, sets-and-venn, averages, algebra, geometry,
  geometry-trigonometry, mixtures, number-properties, ages-and-puzzles,
  directions-and-distance]
- difficulty 1-5 by this rubric:
  1 = single-step arithmetic or one direct formula
  2 = two steps, one concept
  3 = multi-step OR combines two concepts
  4 = requires translating words into equations, has common traps,
      or combines several concepts
  5 = multiple concepts plus a non-obvious insight
Return ONLY a JSON array: [{"i": <index>, "topic": "...", "difficulty": <1-5>}, ...]"""


def llm_tag(batch):
    """Tag a batch of questions via an OpenAI-compatible chat endpoint."""
    user = "\n\n".join(f"[{i}] {q['question']}" for i, q in batch)
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1500,
        "messages": [{"role": "system", "content": RUBRIC},
                     {"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {API_KEY}"})
    with urllib.request.urlopen(req) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    m = re.search(r"\[.*\]", text, re.S)
    return {t["i"]: (t["topic"], int(t["difficulty"])) for t in json.loads(m.group(0))}


def parse_choices(options):
    out = []
    for opt in options:
        m = re.match(r"^([A-E])\)\s*(.*)$", opt.strip())
        out.append({"label": m.group(1), "text": m.group(2)} if m
                   else {"label": opt[:1], "text": opt[2:]})
    return out


def main(files):
    qs = []
    for f in files:
        qs += [json.loads(l) for l in open(f)]
    print(f"Loaded {len(qs)} questions from {files}")

    enriched = []
    for start in range(0, len(qs), BATCH):
        batch = list(enumerate(qs[start:start + BATCH], start=start))
        tags = llm_tag(batch)
        for i, q in batch:
            topic, diff = tags.get(i, ("unclassified", 3))
            steps = q["rationale"].count("\n") + 1
            # deterministic cross-check: flag rubric/proxy disagreements
            flagged = (diff <= 2 and steps >= 9) or (diff >= 4 and steps <= 2)
            enriched.append({
                "id": f"aqua_{i:04d}",
                "exam": "GMAT/GRE Quantitative",
                "question": q["question"],
                "choices": parse_choices(q["options"]),
                "correct": q["correct"],
                "rationale": q["rationale"],
                "topic": topic,
                "difficulty": diff,
                "solution_steps": steps,
                "needs_review": flagged,
                "source": "AQuA-RAT (Apache 2.0)",
            })
        print(f"  tagged {min(start + BATCH, len(qs))}/{len(qs)}")

    json.dump(enriched, open("questions.json", "w"), indent=2)
    n_flag = sum(e["needs_review"] for e in enriched)
    print(f"Wrote questions.json ({len(enriched)} questions, {n_flag} flagged for review)")


if __name__ == "__main__":
    main(sys.argv[1:] or ["test.json", "dev.json"])
