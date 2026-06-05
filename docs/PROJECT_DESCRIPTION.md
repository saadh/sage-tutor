# Sage — The Tutor That Never Forgets You

**Track 7: Adaptive Learning Tutor** · [github.com/saadh/sage-tutor](https://github.com/saadh/sage-tutor)

## The problem

Bloom's 2-sigma problem: 1:1 tutored students outperform classroom students by two standard deviations — but tutors don't scale, and $200/hr tutors keep their model of you in a paper notebook. The GMAT is already a computer-adaptive test, yet every prep tool's adaptivity **resets between sessions**. Students grinding quant prep over weeks are forgotten by their tools every single day.

Sage is the adaptive engine **plus the memory**: a GMAT/GRE quant tutor that lives in your iMessages, quizzes you adaptively, teaches you the moment you struggle, builds a living model of what you know, revises its beliefs as you improve, texts you first when it's time to practice — and when text isn't enough, **talks to you out loud and looks at your handwritten work through your camera**.

## How each technology is used

### Photon — the thread IS the product
- Students take **10-question adaptive sprints entirely over iMessage** (reply A–E, "hint", "walk", "help").
- **The agent texts first**: signup on the web form → Sage texts you → your "GO" reply doubles as phone verification (implicit OTP — nobody can enroll someone else's number). Post-sprint **nudges** reference your actual gap and start a 3-question micro-session when you reply.
- Production hardening from real testing: outbound send retry-with-backoff (the shared pool throws intermittent DEADLINE_EXCEEDED), and message-size discipline (delivery latency scales with text length — two short sends beat one long one).

### Butterbase — the entire backend
- **Database**: users, questions (508 enriched, 467 servable), sessions, attempts, per-topic mastery, nudges, runtime settings. All UUID-keyed (platform requirement discovered: row ops need UUID PKs).
- **Auth**: phone-as-identity with our OTP-over-iMessage flow (Butterbase has no native phone auth — documented fallback); admin portal backed by Butterbase auth.
- **AI Model Gateway**: ALL text LLM calls route through it (`anthropic/claude-haiku-4.5`) — including the LLM node *inside* the RocketRide pipelines and the deployed function. The browser never holds a text-LLM key.
- **Serverless function** (`tutor-chat`): the web tutor room's brain — grounds answers in verified rationales and **RAG** (18 per-topic worked-solution corpora, 119 chunks) for open questions.
- **Sessions bridge surfaces**: full engine state (`sprint_state`) persists on every answer, so texting "help" opens the web tutor room **on the same question of the same session** — and a process crash or browser refresh resumes the exact question, streak and difficulty intact.
- **Config-not-constants**: every runtime parameter (sprint length, staircase thresholds, nudge delay, model, DEMO_MODE) lives in a `settings` table — the admin portal edits them live, no redeploy.

### RocketRide — the tutoring pipelines
- **Fast tutor pipeline** (chat → `llm_openai_api` node pointed at the **Butterbase gateway** → response): every walkthrough, follow-up answer, and grounded explanation in the iMessage flow runs through it — kept deliberately single-node for hot-path latency.
- **Agent pipeline** (`agent_rocketride` + `tool_xtrace_memory` + memory + gateway LLM, portable JSON in `pipelines/`): deep tutoring with live XTrace recall as an agent tool — the agent knows your gaps mid-walkthrough.
- **Enrichment pipeline** (pre-event): solved all 508 questions independently to verify answer keys — **rejected 8%** (41 flagged questions never served), and generated the 3-rung Socratic hint ladders + per-distractor misconception diagnoses that power zero-latency tutoring.

### XTrace — the memory that makes it a tutor
- **Facts**: per-topic beliefs written after every sprint ("User is weak at geometry", "User is strong at percentages") — phrased per our tested extraction findings (dialogue pairs, one belief per ingest, present-state claims).
- **Belief revision — proven live**: when the student improves, the new strength fact **supersedes** the old struggle fact; `GET /memories/{id}/revisions` shows the version chain with `[superseded]` status. The tutor's model of you is self-revising, not append-only.
- **Recall in the loop**: every sprint opens with an XTrace search (2.5s hard budget — memory never delays the student) → "Welcome back — last time geometry gave you trouble. Let's warm up there." The agent pipeline can also recall mid-conversation via the XTrace tool node.
- **Episodes**: each sprint writes a session summary memory; the nudge engine personalizes from recalled gaps.

### Voice — a live tutor in the room (Gemini Live via Vertex AI)
- Tap the voice button in the web tutor room and Sage **speaks**: raw-WebSocket speech-to-speech (16kHz mic in, 24kHz audio out) with **barge-in** — interrupt mid-sentence and queued playback flushes instantly.
- **"Show me your work"**: point your camera at handwritten scratch work; the model reads it and pinpoints the exact line where the error happened.
- **Live context sync**: when the sprint advances, the voice session gets a silent CONTEXT UPDATE (plus a `get_current_question` tool it can call) — so the voice tutor is always talking about the question on your screen, never a stale one.
- Voice is the one deliberate gateway exception: audio streams direct to Vertex; **all text reasoning still routes through the Butterbase gateway**.

## What the integration unlocks

Each technology covers another's gap: Photon gives the agent a human channel but no brain; the RocketRide pipelines give it reasoning but no persistence; Butterbase persists every attempt but doesn't *understand* the student; XTrace turns that history into a self-revising model of the learner that every other layer reads; voice gives that model a face on the hardest moments. Remove any one and the product stops being a tutor: no Photon → no "it texted me first"; no pipelines → no grounded teaching; no Butterbase → no cross-surface session continuity; no XTrace → it forgets you like every other prep tool.

The integration is bidirectional, not a relay: the iMessage sprint and the web room are **the same session** (a `web_token` bridges them, `sprint_state` keeps them in lockstep), the voice tutor reads that same live state, and what the student does on any surface flows back through Butterbase into XTrace beliefs that shape the next sprint's first question.

## Production readiness

- Phone-verified accounts (signup → agent texts → reply verifies) ✓
- Machine-verified content: 41 of 508 questions rejected by the enrichment pipeline, never served ✓
- Config-not-constants: live-editable runtime settings from the admin portal ✓
- Memory survives sessions, with belief revision and version history ✓
- Scoring honesty: hint-assisted answers earn mastery credit but never advance the difficulty staircase ✓
- Crash-transparent: supervisor pattern (loud exit + restart), 60s heartbeat, and per-answer state persistence mean a process death resumes the sprint mid-question ✓
- Roadmap (named, not faked): Photon Business tier (dedicated number), billing, GDPR tooling, multi-exam banks (RACE/AGIEval pending licensing).

## Data

AQuA-RAT (DeepMind, **Apache 2.0** — chosen specifically because RACE/SciQ/AGIEval carry non-commercial/copyright restrictions; this survives the "deployable today" question). 508 curated questions enriched with topic taxonomy (18 topics), difficulty rubric 1-5 (validated against rationale step-count, self-recalibrating from observed success rates), hint ladders, and distractor diagnoses.
