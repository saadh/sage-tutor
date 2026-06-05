# Sage — 3:00 Demo Script (beat by beat)

**Stage setup (do BEFORE you're called):**
- [ ] Laptop on **hotspot** (not venue wifi) · power connected
- [ ] Bot running under supervisor (`bot/run-sage.sh`) — check `http://localhost:8420` loads
- [ ] **Pre-warm** (5 min before): open `localhost:8420/sprint.html`, start a sprint as +966531490549, ask the chat one question (caches the JWT + warms every path), turn voice on/off once (mic permission granted)
- [ ] iPhone screen-mirrored (QuickTime → iPhone) with the **Sage iMessage thread visible** — today's real conversation history is the prop, even if live texts lag
- [ ] Second browser tab: `sage-tutor.butterbase.dev` (landing) · third tab: `/admin.html`
- [ ] Backup video on the desktop, one keypress away
- [ ] `DEMO_MODE=true` in admin config panel (short questions, 2-min nudge)

---

## 0:00 — HOOK (15s)
> "Bloom's 2-sigma problem: a 1:1 tutor makes students two standard deviations better — but tutors don't scale, and a $200-an-hour tutor's model of you lives in a paper notebook. The GMAT is already adaptive, but every prep tool forgets you between sessions. **Sage is the adaptive engine plus the memory** — and it lives in your texts."

*(gesture at the mirrored iPhone thread)*

## 0:15 — MEMORY BEAT (25s)
**Click:** `localhost:8420/sprint.html` → start sprint with your phone number.

> "Watch the greeting — *'Welcome back — last time geometry gave you trouble. Let's warm up there.'* That's not a template. That's **XTrace memory** — every sprint writes beliefs about what I know; the next one opens with them. It remembered me."

## 0:40 — ADAPTIVE + THE STRUGGLE (30s)
**Click:** answer one question correctly (fast), then **answer one WRONG on purpose**.

> "Difficulty follows me — two right and it steps up, the engine is a 2-up/2-down staircase over per-topic mastery in **Butterbase**. Now watch what happens when I get one wrong—"

*(point at the right panel — the tutor jumps in unprompted, naming the specific error)*

> "It didn't say 'incorrect.' It named **my exact mistake** — every distractor in our 467-question bank was machine-diagnosed in advance by a **RocketRide pipeline** that also rejected 8% of questions as broken. Verified content only."

## 1:10 — THE CLOSER: VOICE + CAMERA (45s)
**Click:** 🎤 **Talk it through** → say out loud: *"I don't get it — why is my answer wrong?"*

*(let Sage speak ~10s; interrupt it mid-sentence once — barge-in — and let it adapt)*

> "A live voice tutor that already knows the question on my screen and the mistake I just made."

**Click:** 📷 → hold up a pre-scribbled wrong calculation:

> "—and it reads my handwriting. *(beat)* That error it just spotted? It's looking at my scratch work through the camera. This is **Gemini Live, proxied through a Butterbase Durable Object** — the model key never touches the browser."

## 1:55 — THE BRAIN (20s)
**Say over the sprint summary screen** (finish sprint or pre-have one open):

> "Every sprint ends as an **XTrace episode**: beliefs like 'weak at geometry' get written — and when I improve, the new belief **supersedes** the old one with full version history. The tutor's model of me self-revises. And two minutes after this sprint, Sage texts me first about my weakest topic — reply 'go', three more questions. The tutor that follows up."

## 2:15 — PRODUCTION BEAT (25s)
**Click:** admin tab → edit `NUDGE_DELAY_S` → ✓ live.

> "Every runtime parameter is a **Butterbase settings row** — I just changed production behavior with no redeploy. Anyone can sign up at **sage-tutor.butterbase.dev** right now — same engine, same memory, voice included."

## 2:40 — THE MIC DROP (20s)
> "One more thing. Mid-event today, the platform's model gateway went down and the messaging relay started throttling. **You just watched the demo anyway** — because the tutoring brain fails over to Vertex automatically, sprints survive crashes mid-question, and the web works standalone. We didn't just integrate four technologies — we kept a product alive through two real outages. That's what production-ready means. **Sage: the tutor that never forgets you.**"

---

## If something breaks live
| Failure | Move |
|---|---|
| Voice won't connect | "Voice ran all afternoon — here's 20 seconds of it" → backup video, keep going |
| Chat snag | Ask again once (auto-retry); if dead, narrate the diagnosis flow from the verdict box (pre-gen, always works) |
| iMessage dead | Already de-risked: the thread history on the mirrored phone IS the evidence; don't wait for live texts |
| Internet dies | localhost sprint still works (questions cached); voice dies → backup video |
| Everything dies | Full backup video (3:00 recorded run) |

## Rehearsal checklist (run TWICE, once on hotspot)
- [ ] Full run under 3:00 with a timer
- [ ] Wrong-answer question chosen in advance (know which to miss)
- [ ] Scratch-work paper pre-written (a believable wrong calculation for that question)
- [ ] Record run #2 as the backup video (QuickTime screen + mic)
- [ ] Reset between runs: `localStorage.clear()` not needed (JWT survives); just start a fresh sprint
