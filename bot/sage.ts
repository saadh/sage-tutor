/**
 * Sage — the GMAT/GRE quant tutor that never forgets you.
 * iMessage (Photon/Spectrum) sprint loop crossing all four mandatory techs:
 *   RocketRide  → tutor pipeline (P2): verdicts, walkthroughs, greetings
 *   Butterbase  → users/sessions/attempts/mastery/settings + AI gateway (inside the pipeline)
 *   XTrace      → recall at greeting, struggle facts, sprint episodes w/ belief revision
 *   Photon      → the thread IS the product (agent texts first)
 *
 * Run: npm run dev:sage
 */
import { Spectrum } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";
import { imessage } from "spectrum-ts/providers/imessage";
import crypto from "node:crypto";

import { loadSettings, loadServableQuestions, getOrCreateUser, createSession, updateSession, insertAttempt, insertNudge, loadMastery, saveMastery } from "./lib/db.ts";
import { newSprintState, pickQuestion, recordAnswer, entryDifficulty, summarize, type Question, type SprintState, type MasteryRow } from "./lib/engine.ts";
import { recallStudentContext, recordStruggle, recordSprintEpisode } from "./lib/memory.ts";
import { initTutorPipeline, tutorRespond } from "./lib/tutor.ts";
import { startWebServer } from "./web-server.ts";

const WEB_BASE = process.env.SAGE_WEB_BASE ?? "http://localhost:8420";

// ---------- per-user runtime state ----------
type Phase = "idle" | "in_question" | "awaiting_walkthrough";
interface Live {
  phase: Phase;
  userId: string; // butterbase uuid
  xtraceId: string; // stable xtrace user id (phone-derived)
  sessionId: string | null;
  state: SprintState | null;
  mastery: Map<string, MasteryRow & { id?: string }>;
  current: Question | null;
  qSentAt: number | null;
  hintRung: number; // 0..3 for current question
  lastWrong: { q: Question; answer: string } | null;
  webToken: string | null;
  pendingMicroTopic?: string | null; // set when a nudge was sent, awaiting "go"
  microTopic?: string | null; // active micro-session topic filter
  microLen?: number;
}
const live = new Map<string, Live>(); // key = sender id (phone)

const topicName = (t: string) => t.replace(/-/g, " ");
const dots = (d: number) => "●".repeat(d) + "○".repeat(5 - d);

function questionCard(q: Question, n: number, total: number): string {
  const choices = q.choices.map((c) => `${c.label}) ${c.text.replace(/^[A-E]\)\s*/, "")}`).join("\n");
  // Photon delivery time scales with message length — keep cards lean.
  // The how-to footer only rides on the first question.
  const footer = n === 1 ? `\n\nReply A–E · "hint" · "help" opens the tutor room` : "";
  return `Q${n}/${total} · ${topicName(q.topic)} · ${dots(q.difficulty)}\n\n${q.question}\n\n${choices}${footer}`;
}

async function ensureLive(senderId: string, name?: string): Promise<Live> {
  let L = live.get(senderId);
  if (L) return L;
  const user = await getOrCreateUser(senderId, name);
  L = {
    phase: "idle", userId: user.id, xtraceId: `student-${senderId.replace(/[^0-9a-zA-Z]/g, "")}`,
    sessionId: null, state: null, mastery: await loadMastery(user.id),
    current: null, qSentAt: null, hintRung: 0, lastWrong: null, webToken: null,
  };
  live.set(senderId, L);
  return L;
}

// ---------- sprint flow ----------
/** XTrace recall with a hard time budget — the greeting must never block the quiz. */
async function recallFast(xtraceId: string, budgetMs = 2500): Promise<string | null> {
  return Promise.race([
    recallStudentContext(xtraceId),
    new Promise<null>((r) => setTimeout(() => r(null), budgetMs)),
  ]).catch(() => null);
}

/** One-line memory greeting from recalled facts. Template, zero LLM latency. */
function memoryLine(ctx: string | null): string | null {
  if (!ctx) return null;
  const struggle = ctx.match(/(?:struggles? with|weak at|worst topic[^a-z]*is) ([a-z\- ]+?)[\.\;,]/i)?.[1]?.trim();
  if (struggle) return `Welcome back — last time ${struggle.replace(/-/g, " ")} gave you trouble. Let's warm up there. 🎯`;
  const strength = ctx.match(/strong at ([a-z\- ]+?)[\.\;,]/i)?.[1]?.trim();
  if (strength) return `Welcome back — ${strength.replace(/-/g, " ")} is a strength now. Let's push further. 🎯`;
  return `Welcome back — picking up where we left off. 🎯`;
}

async function startSprint(L: Live, send: (t: string) => Promise<void>) {
  const settings = await loadSettings();
  L.mastery = await loadMastery(L.userId);
  L.state = newSprintState(entryDifficulty(L.mastery, settings));
  L.webToken = crypto.randomBytes(12).toString("hex");
  const session = await createSession(L.userId, "sprint", L.webToken);
  L.sessionId = session.id;
  L.phase = "in_question";
  L.hintRung = 0;
  L.lastWrong = null;
  L.microTopic = null;
  L.pendingMicroTopic = null;

  // memory line (hard 2.5s budget) then Q1 — two SHORT sends beat one long one
  // (Photon delivery time scales with message size; short messages land in ~1-2s)
  const ctx = await recallFast(L.xtraceId);
  const greet = memoryLine(ctx) ?? `Hi, I'm Sage 🎯 Ten adaptive questions, at your pace.`;
  const card = await nextQuestionCard(L, settings.sessionLen);
  if (!card) return endSprint(L, send);
  await send(greet);
  await send(card);
}

/** Effective sprint length: micro-sessions are shorter. */
function lenFor(L: Live, sessionLen: number): number {
  return L.microTopic ? (L.microLen ?? 3) : sessionLen;
}

/** Picks the next question, updates Live state, returns the card text (null = sprint over). */
async function nextQuestionCard(L: Live, sessionLen: number): Promise<string | null> {
  const settings = await loadSettings();
  let questions = await loadServableQuestions();
  if (L.microTopic) {
    const filtered = questions.filter((q) => q.topic === L.microTopic);
    if (filtered.length) questions = filtered; // fall back to full pool if topic exhausted
  }
  if (settings.demoMode) {
    // Photon delivery time scales with message size — on stage, prefer
    // short-text questions so cards land in seconds, not half a minute.
    const short = questions.filter((q) => q.question.length <= 220);
    if (short.length >= 30) questions = short;
  }
  const len = lenFor(L, sessionLen);
  const q = L.state!.history.length >= len ? null : pickQuestion(L.state!, questions, L.mastery);
  if (!q) return null;
  L.current = q;
  L.qSentAt = Date.now();
  L.hintRung = 0;
  return questionCard(q, L.state!.history.length + 1, len);
}

async function handleAnswer(L: Live, label: string, send: (t: string) => Promise<void>) {
  const settings = await loadSettings();
  const q = L.current!;
  const secs = L.qSentAt ? Math.round((Date.now() - L.qSentAt) / 1000) : null;
  const result = recordAnswer(L.state!, q, label, secs, L.mastery, settings, { hintsUsed: L.hintRung });

  // Butterbase writes (await — core loop integrity)
  await insertAttempt({
    session_id: L.sessionId!, question_id: q.id, qid: q.qid, answer: label,
    correct: result.correct, hint_count: L.hintRung, latency_s: secs, surface: "imessage",
  });
  await saveMastery(L.userId, result.masteryUpdate as any).catch((e) => console.error("mastery save:", e));
  await updateSession(L.sessionId!, {
    current_question_id: q.qid,
    question_index: L.state!.history.length,
    sprint_state: JSON.stringify(L.state), // jsonb → JSON string (platform finding); the iMessage→web bridge
  } as any).catch(() => {});

  if (result.correct) {
    let msg = `✓ Correct${secs ? ` — ${secs}s` : ""}.${secs && secs <= 90 ? " Solid pace." : ""}`;
    if (L.hintRung > 0) msg += ` (hints used — mastery credit only)`;
    if (result.adaptNote) msg += `\n⚖️ ${result.adaptNote}`;
    L.lastWrong = null;
    // two short sends beat one long one (Photon latency scales with size)
    const card = await nextQuestionCard(L, settings.sessionLen);
    await send(msg);
    if (!card) return endSprint(L, send);
    await send(card);
    return;
  }

  // wrong: pre-generated diagnosis = instant verdict, zero LLM in the hot path.
  // The RocketRide pipeline runs only on explicit "walk" (depth worth waiting for).
  const diagnosis = q.distractor_diagnoses?.[label];
  L.lastWrong = { q, answer: label };
  const parts = [
    `✗ The answer is ${q.correct}.${diagnosis ? `\n🔍 ${diagnosis}` : ""}`,
  ];
  if (result.floorRuleFired) {
    recordStruggle(L.xtraceId, q.topic, `Two misses at difficulty 1 indicate a concept gap, not a difficulty problem.`);
    parts.push(`📚 Flagged ${topicName(q.topic)} for instruction.`);
  } else if (result.adaptNote) {
    parts.push(`⚖️ ${result.adaptNote}`);
  }
  parts.push(`"walk" = walkthrough · "next" = keep going`);
  await send(parts.join("\n"));
  L.phase = "awaiting_walkthrough";
}

async function endSprint(L: Live, send: (t: string) => Promise<void>) {
  const summary = summarize(L.state!);
  await updateSession(L.sessionId!, { state: "done", ended_at: new Date().toISOString(), score: summary.nCorrect, sprint_state: JSON.stringify(L.state) } as any).catch(() => {});
  await recordSprintEpisode(L.xtraceId, L.sessionId!, summary, "sprint");
  const lines = [
    `🏁 Sprint complete: ${summary.nCorrect}/${summary.total}${summary.avgSecs ? ` · avg ${summary.avgSecs}s/q` : ""} · peak difficulty ${summary.peakDifficulty}/5`,
    summary.strengths.length ? `💪 Strong: ${summary.strengths.map(topicName).join(", ")}` : "",
    summary.gaps.length ? `🎯 Needs work: ${summary.gaps.map(topicName).join(", ")}` : "No gaps this sprint!",
    `Your full breakdown: ${WEB_BASE}/sprint.html?token=${L.webToken}`,
    `Text "start" anytime for another sprint.`,
  ].filter(Boolean);
  await send(lines.join("\n"));
  scheduleNudge(L, summary, send);
  L.phase = "idle";
  L.current = null;
  L.state = null;
  L.microTopic = null;
}

/** Post-session follow-up nudge — the "it texted me first" beat.
 *  DEMO_MODE compresses the delay so it fires on stage mid-pitch.
 *  Replying starts a short micro-session on the weakest topic. */
function scheduleNudge(L: Live, summary: ReturnType<typeof summarize>, send: (t: string) => Promise<void>) {
  const gap = summary.gaps[0];
  if (!gap) return;
  loadSettings().then((settings) => {
    const delayMs = settings.nudgeDelayS * 1000;
    console.log(`nudge scheduled: ${gap} in ${settings.nudgeDelayS}s`);
    setTimeout(async () => {
      if (L.phase !== "idle") return; // don't interrupt an active sprint
      const body = `👋 Quick thought — ${topicName(gap)} tripped you up earlier. Three questions to lock it in? Reply "go" and I'll keep it short.`;
      try {
        await send(body);
        await insertNudge({ user_id: L.userId, trigger_type: "post_session_gap", body, sent_at: new Date().toISOString() });
        L.pendingMicroTopic = gap;
        console.log(`nudge sent: ${gap}`);
      } catch (e) {
        console.error("nudge send failed:", e);
      }
    }, delayMs);
  }).catch(() => {});
}

/** 3-question micro-session focused on one topic (nudge reply flow). */
async function startMicroSession(L: Live, topic: string, send: (t: string) => Promise<void>) {
  const settings = await loadSettings();
  L.mastery = await loadMastery(L.userId);
  const entry = Math.max(1, Math.min(5, Math.round(L.mastery.get(topic)?.level ?? settings.defaultEntryLevel)));
  L.state = newSprintState(entry);
  L.webToken = crypto.randomBytes(12).toString("hex");
  const session = await createSession(L.userId, "micro", L.webToken);
  L.sessionId = session.id;
  L.phase = "in_question";
  L.pendingMicroTopic = null;
  L.microTopic = topic;
  L.microLen = settings.microSessionLen;
  const card = await nextQuestionCard(L, settings.microSessionLen);
  if (!card) return endSprint(L, send);
  await send(`Let's lock in ${topicName(topic)} — ${settings.microSessionLen} quick ones. 💪\n\n${card}`);
}

// ---------- message routing ----------
async function handleMessage(L: Live, text: string, send: (t: string) => Promise<void>) {
  const t = text.trim().toLowerCase();
  const settings = await loadSettings();

  // ===== global commands — work in EVERY phase (the "help" bug fix) =====
  if (t === "help" && L.sessionId) {
    await updateSession(L.sessionId, {
      current_question_id: (L.lastWrong?.q ?? L.current)?.qid ?? null,
      sprint_state: JSON.stringify(L.state),
    } as any).catch(() => {});
    return send(`Tutor room — same question, talk to me there:\n${WEB_BASE}/sprint.html?token=${L.webToken}`);
  }
  if (t === "stop") {
    if (L.sessionId) await updateSession(L.sessionId, { state: "done", ended_at: new Date().toISOString() } as any).catch(() => {});
    L.phase = "idle";
    return send(`Paused. Text "start" whenever you're ready.`);
  }
  if (t === "progress" && L.state) {
    const done = L.state.history.length;
    const right = L.state.history.filter((h) => h.correct).length;
    return send(`${done}/${lenFor(L, settings.sessionLen)} answered, ${right} correct, difficulty ${L.state.difficulty}/5.`);
  }

  // nudge reply → micro-session on the flagged topic
  if (L.phase === "idle" && L.pendingMicroTopic && ["go", "yes", "y", "sure", "ok", "let's go", "lets go"].includes(t)) {
    return startMicroSession(L, L.pendingMicroTopic, send);
  }
  if (["start", "go", "begin", "practice", "hi", "hello", "hey"].includes(t)) return startSprint(L, send);

  if (L.phase === "in_question" && L.current) {
    const label = t.toUpperCase();
    if (["A", "B", "C", "D", "E"].includes(label)) return handleAnswer(L, label, send);
    if (t === "hint" || t.includes("stuck")) {
      const hints = L.current.hints ?? [];
      if (L.hintRung < hints.length) {
        const h = hints[L.hintRung++];
        return send(`💡 ${L.hintRung}/3: ${h}`);
      }
      return send(`That's all three hints — take your best shot, A–E.`);
    }
    // free-text during a question → instant canned nudge (NO agent call in the hot path)
    return send(`Answer A–E when ready · "hint" for a nudge · "help" for the tutor room.`);
  }

  if (L.phase === "awaiting_walkthrough" && L.lastWrong) {
    const { q, answer } = L.lastWrong;
    if (["walk", "yes", "y", "sure", "ok", "walk me through it", "yes please"].includes(t)) {
      const wt = await tutorRespond({
        intent: "walkthrough", questionText: q.question,
        choices: q.choices.map((c) => `${c.label}) ${c.text}`).join(" "),
        studentAnswer: answer, correctAnswer: q.correct, rationale: q.rationale ?? "",
      });
      await send(wt ?? `Here's the path: ${q.rationale}`);
      return; // stay in awaiting_walkthrough for follow-up questions
    }
    if (["next", "n", "continue", "skip"].includes(t)) {
      L.phase = "in_question";
      L.lastWrong = null;
      const card = await nextQuestionCard(L, settings.sessionLen);
      if (!card) return endSprint(L, send);
      return send(card);
    }
    // free-text follow-up inside walkthrough
    const reply = await tutorRespond({
      intent: "walkthrough", freeText: text, questionText: q.question,
      choices: q.choices.map((c) => `${c.label}) ${c.text}`).join(" "),
      studentAnswer: answer, correctAnswer: q.correct, rationale: q.rationale ?? "",
    });
    return send((reply ?? "Good question — look at the rationale step where that comes from.") + `\n\n("next" to continue the sprint)`);
  }

  return send(`Hi, I'm Sage 🎯 Text "start" for a 10-question adaptive sprint. "stop" pauses anytime.`);
}

// ---------- boot ----------
let { PROJECT_ID, PROJECT_SECRET, MY_PHONE } = process.env;
if (PROJECT_ID?.startsWith("paste-your")) PROJECT_ID = PROJECT_SECRET = undefined;

let imSendTo: ((phone: string, text: string) => Promise<void>) | undefined;

async function makeApp() {
  if (PROJECT_ID && PROJECT_SECRET) {
    const app = await Spectrum({
      projectId: PROJECT_ID,
      projectSecret: PROJECT_SECRET,
      providers: [terminal.config(), imessage.config()],
    });
    console.log("Sage up — terminal + iMessage providers active.");
    const im = imessage(app);
    imSendTo = async (phone: string, text: string) => {
      const target = await im.user(phone);
      const space = await im.space(target);
      await space.send(text);
    };
    if (MY_PHONE) {
      try {
        await imSendTo(MY_PHONE, `Sage here 🎓 Your adaptive quant tutor is live. Text "start" for a 10-question sprint.`);
        console.log(`Outbound hello sent to ${MY_PHONE}.`);
      } catch (err) {
        console.error("Outbound iMessage failed:", err);
      }
    }
    return app;
  }
  console.log("Sage up — terminal only (set PROJECT_ID/PROJECT_SECRET for iMessage).");
  return Spectrum({ providers: [terminal.config()] });
}

const app = await makeApp();

// preload caches + pipeline (xtrace tool user id is set per-process; per-student
// recall happens via lib/memory.ts; pipeline tool covers the demo student)
await loadServableQuestions().then((qs) => console.log(`✓ ${qs.length} servable questions cached from Butterbase`));
const demoXtraceId = `student-${(MY_PHONE ?? "demo").replace(/[^0-9a-zA-Z]/g, "")}`;
await initTutorPipeline(demoXtraceId);
startWebServer(8420, { sendTo: imSendTo, geminiKey: process.env.key ?? process.env.GEMINI_API_KEY }); // web layer + APIs

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  const text = message.content.text;
  const senderId = message.sender?.id ?? "terminal-user";
  console.log(`[${message.platform}] ${senderId}: ${text}`);
  const t0 = Date.now();
  try {
    const L = await ensureLive(senderId);
    await handleMessage(L, text, async (t: string) => {
      console.log(`[send +${Date.now() - t0}ms] ${t.slice(0, 70).replace(/\n/g, " ")}…`);
      // Photon's shared pool intermittently throws DEADLINE_EXCEEDED — retry
      // with backoff so blips become delays, not dropped questions.
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await space.send(t);
          console.log(`[sent +${Date.now() - t0}ms attempt ${attempt}]`);
          return;
        } catch (e) {
          lastErr = e;
          console.error(`[send FAIL attempt ${attempt}] ${(e as any)?.cause?.details ?? (e as any)?.message ?? e}`);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      throw lastErr;
    });
  } catch (e) {
    console.error("handler error:", e);
    await space.send("Hit a snag — text me again in a few seconds.").catch(() => {});
  }
}
