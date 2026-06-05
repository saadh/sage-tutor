# Sage — The Tutor That Never Forgets You

**Single source of truth for the hackathon build.** Everything decided, discovered, and built during prep. Read this top-to-bottom before writing any code.

> **One-liner:** Sage is an adaptive GMAT/GRE quant tutor that lives in your iMessages — it quizzes you adaptively, teaches you when you struggle, builds a living model of what you know, revises its beliefs as you improve, and texts you first when it's time to practice.

---

## 1. Hackathon Hard Requirements (UPDATED version — supersedes the .docx)

Track 7: **Adaptive Learning Tutor**. Track-row guidance: *RocketRide: Adaptive questioning · Butterbase: Progress history · XTrace: Knowledge gap memory · Photon: Practice nudges via iMessage.*

**Mandatory (miss any = disqualified):**
1. **RocketRide** — core data/AI pipelines and workflows; pipelines meaningfully connected to logic (not a stub). (rocketride.ai · docs.rocketride.org)
2. **Butterbase** — provision and serve the backend: **database + auth + AI Model Gateway** at minimum. All text LLM calls route through the gateway. (butterbase.ai · docs.butterbase.ai)
3. **XTrace** — Memory API: agents **actively write to and read from** persistent memory. Judges score depth: **episodes, artifacts, belief revision, multi-user memory** — explicitly NOT "plain RAG or log." (docs.mem.xtrace.ai)
4. **Photon** — deliver the agent through **at least one real messaging platform** (iMessage/WhatsApp/Slack). (photon.codes — Spectrum SDK)
5. **Deep integration** — all four woven into the core product experience.

**Evaluation criteria:** RocketRide pipeline depth/multi-agent/real-world data flow · Butterbase sophistication (schema, auth, gateway, real-time sync, RAG) · XTrace depth · Innovation/originality · Technical complexity · Real-world impact ("deployable today?") · Demo quality.

**Deliverables:** working prototype (live/local demo) · repo link · project description (problem + how each tech is used + what integration unlocks) · optional pitch deck/video.

**Submission:** via Butterbase connection — **allow 30 minutes**; start no later than T-30min.

---

## 2. Product Concept

**User:** GMAT/GRE candidates grinding quant prep over weeks/months — a multi-session journey where every existing tool forgets them between sessions.

**Pitch frame (use on stage):** Bloom's 2-sigma problem — 1:1 tutored students outperform classroom by two standard deviations, but tutors don't scale. The 2-sigma effect = (1) knowing exactly where the student is → **XTrace**, (2) intervening the moment they struggle → **tutoring layer**, (3) following up until it sticks → **nudges + re-checks**. Sage does all three, in your messages.

**Second pitch line:** "The GMAT is already a computer-adaptive test — but its adaptivity resets every session, and your $200/hr tutor's memory lives in a notebook. Sage is the adaptive engine plus the memory."

**Differentiation vs other Track-7 teams:** (a) belief revision demoed live (XTrace supersedes "weak at X" with version history), (b) agent-texts-first nudges that start real micro-sessions (most teams will ship one-way "time to practice!" pings), (c) machine-verified question bank with a rejection count, (d) optional voice+camera "show me your work" moment.

---

## 3. Core UX (all decided — do not relitigate)

### Delivery: the iMessage thread IS the product
- Chat = tutor (questions, answers, feedback, teaching). Web = landing + signup + student dashboard + admin portal. Photon free tier has **no inbound number — the agent texts first** (shared sender pool; Business tier = dedicated number → one roadmap sentence).

### Onboarding & accounts (PUBLIC PRODUCT — anyone on the internet can sign up)
- **Identity = phone number** (it IS the delivery address). Email optional (recovery/transcripts, roadmap).
- **Signup flow (core, never cut):** landing page → form (name, phone, exam date) → Butterbase auth creates account → **Sage texts the user**: "reply GO to begin" → the GO reply (a) proves phone possession (implicit OTP — nobody can enroll someone else's number), (b) opens the thread, (c) triggers the first calibration sprint. Photon's agent-texts-first constraint = the verification mechanism. NOTE: this REPLACES the old "first inbound message creates account" idea, which was impossible on free tier (no inbound number).
- **Dashboard/admin login:** enter phone → Sage texts a 6-digit code → enter code → session. OTP over iMessage, zero passwords. Built on Butterbase auth (mandatory checkbox); check at event whether Butterbase has native phone/OTP — use it if so; email magic-link fallback.
- Abuse guards (v1): one account per phone, Photon daily quotas as natural rate limit, code expiry 10 min.

### Session model
- **10-question adaptive sprints** (~15–20 min). Each completed sprint = one **XTrace episode**.
- **3-question micro-sessions** when replying to a nudge (low-friction chat dose).
- No chapters, no infinite mode (v1). Mixed-review only (focus-topic mode was cut for solo scope).

### Adaptive engine (2-up / 2-down staircase — implemented & tested in webapp/)
- **2 consecutive correct → difficulty +1** (one correct could be a lucky 20% guess on 5-option MCQ).
- **1 incorrect → stay**, show worked rationale.
- **2 consecutive incorrect → difficulty −1** (never a third question they can't do).
- **Floor rule:** 2 misses at difficulty 1 = concept gap, not difficulty → switch to teaching mode; write "needs instruction" fact to XTrace; route to teacher group.
- Mastery is **per-topic** (topic × difficulty, never global difficulty): per-topic level nudged by `level += 0.3 * ((correct ? q.diff + 0.5 : q.diff − 1) − level)`; default entry level 2.
- Mixed-review topic selection: weight toward weakest topics (pick among 3 weakest, 50% chance to surface unseen topics), avoid repeating last topic.
- **Pacing:** no forced timer. Answer latency from message timestamps (free in chat!). ~2 min/question soft signal. Slow-but-correct → show rationale anyway + record "shaky" signal.

### Tutoring layer (the actual tutoring — the gap we identified and closed)
1. **Hint ladder** — student replies "hint": 3 Socratic rungs (orient → first step → full setup), **pre-generated per question from the verified rationale** (zero latency, zero hallucination, already in questions.json).
2. **Diagnose → teach on wrong answer** — the chosen distractor identifies the error (pre-generated `distractor_diagnoses`); then offer: "Want me to walk through it?" → conversational walkthrough where student can ask free-text follow-ups ("why divide by 120?") — LLM via gateway, grounded in rationale + RAG.
3. **Micro-lessons** (gradual release: Explain → I do → We do → You do) — triggered by floor rule or on demand ("I don't get percentages"). Lesson grounded in the topic's rationale corpus (Butterbase RAG). Ends with a check question; outcome recorded with lesson as provenance.
4. **Close the loop** — next session opens with a check on whatever was taught; nudge references it. XTrace records "knows X *because of lesson Y*, verified by check Z."

### Scoring honesty (pitch it)
- Unaided correct = full signal (advances staircase). With hints = partial (no staircase advance). After walkthrough = no advance + re-check scheduled.

### Nudges (Photon showcase — track row names this)
- Triggers (priority order if cutting): (1) **post-session follow-up on today's gap** ← demo beat, keep; (2) spaced repetition 1/3/7-day; (3) inactivity 24h; (4) goal pacing vs exam date.
- Copy is personalized from XTrace facts (cite the actual gap/session). **Replying starts a 3-question micro-session in-thread.**
- `DEMO_MODE`: compress nudge delay to ~120s so it fires on stage mid-pitch.

### Voice stretch goal (HARD-GATED)
- **Gemini Live 2.5 Flash** (chosen over ElevenLabs for: native speech-to-speech, **camera/screen input**, user can get the key, team-GCP synergy). "Talk it through" button at moment of struggle; short sessions, context injected from XTrace at open, episode written at close.
- Killer beat: **"show me your work"** — student holds handwritten scratch work to camera; Sage spots the error line. Work photo → XTrace **artifact** in provenance chain.
- Voice streams direct to Google (gateway exception — one sentence in project description; all text calls still via gateway).
- **Gates:** (1) pre-event hello-world (mic in, voice out, one function call, one camera frame) or it's demo-video-only; (2) at event, voice work starts only after hour-2 vertical slice is alive. ElevenLabs = voice-only fallback.
- Voice demo beat goes LAST in the demo (strongest moment).

---

## 4. Architecture

```
Student's iPhone (iMessage via Photon/Spectrum)        Browser dashboard (read-only)
        │  ▲ (agent texts FIRST — nudges open threads)        │
        ▼  │                                                   ▼
   Photon webhook/stream ──→ Bot/backend (Node/TS, bot/) ◄── Butterbase real-time
                                   │
                  ┌────────────────┼──────────────────┐
                  ▼                ▼                   ▼
            RocketRide        Butterbase            XTrace
            pipelines:        DB: users/sessions/   facts: gaps & mastery beliefs
            P1 enrichment     attempts/mastery/     episodes: per sprint/voice call
            (done pre-event)  questions             artifacts: quizzes, work photos
            P2 tutor loop:    auth (phone-keyed)    belief revision w/ history
            select→evaluate→  AI Model Gateway      multi-user: route gap-facts
            diagnose→calibrate(ALL text LLM calls)  to "teacher" group policy
            P3 session        RAG: rationale corpus
            summarizer        real-time sync → dashboard
            P4 nudge decider
```

**RocketRide pipelines (judged on depth — these are the multi-agent story):**
- P1 Enrichment/validation (already executed in prep — present it as the pipeline that built the bank: solved every question independently, rejected 8%).
- P2 Tutor loop: QuestionSelector (reads Butterbase mastery + XTrace context) → Evaluator (string-compare verdict = infallible; LLM explanation grounded in rationale) → MisconceptionDetector (pre-gen diagnoses + live LLM for free-text) → DifficultyCalibrator (staircase).
- P3 Session summarizer → writes episode + revised beliefs to XTrace, routes to teacher group.
- P4 Nudge decider (scheduled): who, about what, when — inputs from XTrace.
- Pipelines must be visibly RocketRide (build in its VS Code builder, portable JSON in repo, called via SDK/MCP) — not just Node functions. Wire the bot to invoke them.

**Butterbase schema (draft):** `users(id, phone, name, email?, exam_date, role['student'|'admin'], verified_at, created_at)` · `questions(id, exam, question, choices, correct, rationale, topic, difficulty, hints, diagnoses, verified)` · `sessions(id, user, mode, started, ended, score)` · `attempts(id, session, question, answer, correct, hint_count, latency_s, ts)` · `mastery(user, topic, level, attempts, correct)` · `nudges(id, user, trigger, sent_at, replied)` · `otp_codes(phone, code, expires_at)` · **`config(key, value)`** ← ALL runtime parameters (SESSION_LEN, staircase thresholds, nudge delay, model, DEMO_MODE) live here, NOT as code constants — the bot reads config from Butterbase, so admin edits take effect live without redeploy.

**Admin portal (one page, three panels — scoped deliberately):**
1. **Users panel:** list w/ last-active, session count, accuracy, hint rate, nudge-reply rate (Butterbase reads + real-time sync).
2. **Usage panel:** questions answered today, active students, avg session length, flagged-question count.
3. **Config panel ⭐:** edit the `config` table rows live — demo beat: change nudge delay from the portal, no redeploy ("production-ready" in 10 seconds).
Admin auth = same phone-OTP flow + `role='admin'` (user's own phone seeded as admin). Deliberately cut (say "roadmap" — reads as maturity): question editing, user bans, cohort analytics, billing.

**XTrace design:** facts = mastery beliefs + concept gaps + learning context ("slow under pressure on geometry"); episodes = sprints/micro-sessions/voice calls with gist; artifacts = generated quizzes, lesson record, work photos; belief revision = "struggles with integration by parts" superseded by "mastered (session 9)" with version history — **THE demo money shot**; natural-language policy: "route knowledge-gap memories to the teachers group."

---

## 5. Data Layer (DONE — do not rebuild)

- **Source:** AQuA-RAT (DeepMind), **Apache 2.0** — chosen because RACE/SciQ/AGIEval all have non-commercial/copyright problems; AQuA-RAT is the only clean license → survives the "deployable today" question. ~100k GMAT/GRE-style MCQs; we use the curated dev+test splits (508).
- **`data/questions.json`** — 508 enriched: id, question, choices[{label,text}], correct, rationale, topic (18-topic taxonomy), difficulty 1–5 (rubric), hints[3] (orient/first-step/setup — never reveal answer), distractor_diagnoses{label→error sentence}, solution_steps, verified, needs_review, exam, source.
- **467 servable · 41 flagged** (`questions_flagged.json` — wrong keys, garbled text, duplicate options). **Serve ONLY verified && !needs_review.** Known-broken example for storytelling: aqua_test_0010 (rationale uses 450 vs question's 420; no option is actually correct).
- Difficulty distribution (servable): 29/123/168/122/25 for d1–d5. Top topics: percentages 60, algebra 58, speed-time-distance 43, ratio 40, geometry 39.
- Difficulty provenance (judges may ask "who decided?"): (1) LLM rubric (1=single step … 5=multi-concept+insight), (2) cross-checked vs rationale step-count (rises monotonically 3.9→9 steps — validated), (3) **self-corrects empirically from observed success rates** stored in Butterbase (pitch line: "seeded by rubric, recalibrated by reality").
- At event: load questions.json into Butterbase table + ingest rationales into Butterbase RAG ("two API calls" per their docs).
- `data/enrich.py` — the enrichment script (point LLM_BASE_URL at the Butterbase gateway at the event and re-run a slice for compliance optics if useful).

---

## 6. Message Protocol (the contract between webhook and engine)

Student → Sage: `start` (or any greeting) · `A`–`E` answer · `hint` / "I'm stuck" · free-text question (during walkthrough) · `progress` · `stop`.
Sage → student message templates: session greeting (XTrace-grounded: "Last time you struggled with X — let's warm up there") · question card (topic + difficulty dots + Q + A–E) · verdict (✓/✗ + diagnosis if wrong + offer walkthrough) · staircase notices ("Two in a row — stepping up to 3/5") · session summary (score, strengths, gaps, "resume at d3") · nudge (personalized, reply-to-start).
Tone: warm, brief, zero corporate filler. Use `space.responding()` for typing indicator.

Internal API shape (if dashboard needs endpoints): `POST /api/session/start {topic?} → {greeting, question}` · `POST /api/answer {sessionId,questionId,answer} → {correct, explanation, misconception, masteryUpdate, nextQuestion}` · `POST /api/session/end → {summary, strengths, gaps}` · `GET /api/mastery → {topics:[{topic, level, attempts, trend}]}`.

---

## 7. Build Status & Plan

### Pre-hackathon checklist
- ✅ **Photon**: working on real iPhone. `bot/echo.ts` — terminal + iMessage providers; agent-texts-first via `imessage(app)` → `im.user(MY_PHONE)` → `im.space(me)` → `space.send(...)`. Quotas: 5,000 msg/server/day, 50 new conversations/line/day (plenty). Creds in `bot/.env` (gitignored). `npm run dev` (uses `node --env-file-if-exists=.env --import tsx`).
- ✅ **Data layer** complete (above).
- ✅ Web prototype of full adaptive engine: `webapp/index.html` (serve: `python3 -m http.server 8420 -d webapp`). Port `pickQuestion`/`recordAnswer`/mastery logic to the bot; home screen becomes the dashboard.
- ✅ Butterbase account + **MCP connected globally** (`claude mcp list` → butterbase ✓). NOTE: MCP tools only load in sessions started AFTER it was added — restart session to use. API keys were show-once; **regenerate/create-new in dashboard** when runtime keys needed (placeholders ready in `bot/.env`).
- ⬜ XTrace: key obtained (user has it; paste into `bot/.env`), connectivity smoke test, read quickstart (docs.mem.xtrace.ai), design fact/episode/artifact calls.
- ⬜ RocketRide: account, install VS Code extension, build one toy pipeline, learn export-as-JSON + SDK/MCP invocation.
- ⬜ Port adaptive engine behind Photon message loop (sprint state machine: idle → in_question → awaiting_walkthrough → done).
- ⬜ Tutor prompts: persona, Socratic walkthrough rules, misconception prompt, lesson prompt, nudge copy. (User = PM owns tone.)
- ⬜ Demo script doc + Session-1 seed fixture (pre-seeded "struggling student" history so the resume-demo always works).
- ⬜ Gemini Live hello-world (VOICE GATE — fails ⇒ cut voice, zero guilt).
- ⬜ **Pre-build the entire web layer against mock data** (user's wheelhouse — vibe-code before the event, wire to Butterbase at the event): landing page w/ signup form, student dashboard (port webapp/ home screen), admin portal (3 panels), OTP login screen. One consistent design language (reuse webapp/ aesthetic).
- ⬜ GitHub repo (private) when coding starts: bot/ pipelines/ webapp/ web/ data/ docs/; .env never committed.

### Event-day hour-by-hour (solo + Claude Code)
- 0:00–0:30 Provision: Butterbase schema via MCP, load questions.json, RAG-ingest rationales, env wiring.
- 0:30–2:00 **VERTICAL SLICE** (sacred): text "start" → question in iMessage → reply "B" → verdict → attempt in Butterbase + fact in XTrace → next question. All four technologies crossed by hour 2 or activate cut list.
- 2:00–3:15 Staircase + XTrace-grounded greeting + hint command (pre-gen data).
- 3:15–4:15 Diagnose→walkthrough + post-session nudge (DEMO_MODE timer) + dashboard page.
- 4:15 **Voice gate decision.**
- 4:15–5:15 Rehearse demo twice with seed data; record backup video; fix.
- 5:15–6:00 Submit via Butterbase (30-min warning!) + project description (draft beforehand, insert screenshots).

### Cut order under pressure
spaced-rep nudge triggers (keep post-session nudge) → micro-lessons ("We do" first) → admin usage/users panels (config table survives regardless — the bot reads it either way) → student dashboard → voice → **NEVER**: signup flow (the only way in), hints/walkthrough/chat-tutor (the heart).

### Production/scale story (close the pitch with this)
"Everything you saw runs on the same auth, persistence, and config paths a 10,000-student deployment would use": phone-verified accounts ✓ · config-not-constants ✓ · machine-verified content (41 rejected) ✓ · memory that survives sessions ✓ · known scaling path: Photon Business tier (dedicated number, higher quotas) + queueing nudge sends. NOT built (don't pretend): billing, GDPR tooling, moderation — name them as roadmap.

### Solo rules
- 15-minute debugging timebox: stuck → cut or fake for demo, move on.
- Parallel Claude Code sessions as "teammates" where useful.
- Morning team-formation window: pitch with the working bot + this brief in hand (working iMessage demo = best recruiting tool). Best-fit candidates from the (now unresponsive) pool if present: Shloak Aggarwal (agentic tutor interest), Nishant Dhongadi (wants a frontend-owning PM partner), Prabhakar Elavala (picked this track), Mohana Chivukula (strongest engineer, "any" team).

---

## 8. Demo Script (3 minutes — rehearse twice)

1. **Hook (20s):** Bloom 2-sigma + "the GMAT is adaptive but it forgets you."
2. **Resume beat (40s):** iPhone mirrored. Text "start" → *"Welcome back. Yesterday geometry gave you trouble — let's start gentle."* (from pre-seeded Session-1 history). Answer two correct → "stepping up to 3/5."
3. **Tutoring beat (60s) — the heart:** miss a question → diagnosis names the *specific* error from the chosen distractor → "hint" on next one → Socratic rung → "walk me through it" → 2-message exchange → check question → correct.
4. **Memory beat (30s):** dashboard: mastery map updating live (Butterbase real-time). XTrace console: the old belief "weak at percentages-base" **superseded** with version history + lesson provenance.
5. **Nudge beat (20s):** mid-sentence, the phone buzzes — nudge referencing the gap from 2 minutes ago → reply → micro-session starts. ("It texted me first. It knows why.")
6. **Voice beat if alive (30s):** "talk it through" → speak → "show me your work" camera → Sage spots the handwritten error → work photo lands as XTrace artifact.
7. **Production beat (20s):** flash the landing page — "anyone can sign up right now: phone number, one text reply, you're learning" (live if a second phone is handy, else 15s pre-recorded clip). Then the admin portal: change nudge delay in the config panel, no redeploy.
8. **Close (20s):** production-ready checklist: phone-verified auth ✓ persistence ✓ verified bank (41 rejected) ✓ memory survives sessions ✓ config-not-constants ✓ — "a real class could onboard tomorrow." Roadmap: dedicated number, more exams (RACE/AGIEval pending licensing), bring-your-own past papers, billing.

**Risk hygiene:** backup video mandatory; rehearse on venue wifi AND phone hotspot; pre-seed everything the demo needs.

---

## 9. Hard-won findings (don't rediscover)

- Photon/Spectrum: TS-only SDK (`spectrum-ts@1.18.0`); needs `skipLibCheck`; Spectrum() overloads = both creds or neither (no string|undefined); type-narrowing breaks across `responding()` callback — capture `const text` after the guard; terminal provider for credless local dev; `message.platform` distinguishes channels.
- This harness: background subagents' Write calls auto-deny (no prompt channel) — recover payloads from transcript JSONL or have agents return text (see memory: background-agent-write-denials).
- AQuA-RAT data has ~8% broken items even in curated splits — never serve unverified questions.
- Butterbase MCP tools require session restarted after MCP add. Submission requires Butterbase connection + 30 min.
- IELTS/TOEFL MCQ banks effectively don't exist publicly (copyright); RACE/SciQ/AGIEval = non-commercial/copyright issues → AQuA-RAT only. Multi-exam = roadmap slide, not build.

### Butterbase platform findings (discovered at event, 2026-06-05)
- App: `app_7m70nwelqpk6` · API `https://api.butterbase.ai/v1/app_7m70nwelqpk6` · frontend `https://sage-tutor.butterbase.dev` · region us-east-1.
- **Row ops (GET/PATCH/DELETE by id) require UUID PKs** — text PKs can't be updated/deleted by path. ALL tables use uuid `id`; question's AQuA id lives in unique `qid` column.
- **jsonb columns must be sent as JSON-encoded STRINGS** in POST bodies (raw arrays/objects → VALIDATION_INVALID_INPUT).
- **`config` is a reserved route** (`/v1/{app_id}/config` = app configuration) — table renamed to `settings(name unique, value)`. `?key=` query param is also intercepted; use `name`.
- No filtered DELETE (`?col=eq.x`) — delete by uuid path only.
- Auth: email/password + OAuth only — **NO native phone/OTP** → custom OTP over iMessage via otp_codes table (as pre-planned fallback); Butterbase auth backs admin portal.
- Gateway: `/v1/{app_id}/chat/completions`, same service key, default model set to `anthropic/claude-haiku-4.5` (300+ models incl. gemini-2.5-flash). Verified working.
- Settings live-PATCH by uuid verified — admin config panel demo beat is real.

### XTrace findings (smoke test passed, 2026-06-05)
- SDK `@xtraceai/memory`; needs `XTRACE_API_KEY` (xtk_) + `XTRACE_ORG_ID` (org_) — both in bot/.env. Base `https://api.production.xtrace.ai`.
- **BELIEF REVISION PROVEN:** flat present-state claims ("Base identification is one of my strengths") → fact extraction + automatic supersede of the contradicting old fact. `GET /v1/memories/{id}/revisions` returns the chain with `[superseded]` status. THE demo money shot is real.
- **Phrasing rule:** "Update on X:..." phrasing → extracted as ARTIFACT, no supersede. P3 summarizer must write present-state factual claims, one belief per sentence.
- Ingest result envelope: `memories_created / memories_updated / memories_superseded`.
- Facts carry `details.episode_id` (episodes exist server-side); `list({type:"episode"})` returned 0 — surface episodes via search compose mode instead.
- Smoke test user: `smoke-test-student` (keep out of demo data).
