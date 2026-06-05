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

import { loadSettings, loadServableQuestions, getOrCreateUser, createSession, updateSession, insertAttempt, loadMastery, saveMastery } from "./lib/db.ts";
import { newSprintState, pickQuestion, recordAnswer, entryDifficulty, summarize, type Question, type SprintState, type MasteryRow } from "./lib/engine.ts";
import { recallStudentContext, recordStruggle, recordSprintEpisode } from "./lib/memory.ts";
import { initTutorPipeline, tutorRespond } from "./lib/tutor.ts";

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
}
const live = new Map<string, Live>(); // key = sender id (phone)

const topicName = (t: string) => t.replace(/-/g, " ");
const dots = (d: number) => "●".repeat(d) + "○".repeat(5 - d);

function questionCard(q: Question, n: number, total: number): string {
  const choices = q.choices.map((c) => `${c.label}) ${c.text.replace(/^[A-E]\)\s*/, "")}`).join("\n");
  return `Q${n}/${total} · ${topicName(q.topic)} · ${dots(q.difficulty)}\n\n${q.question}\n\n${choices}\n\nReply A–E. Or "hint" / "help".`;
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
async function startSprint(L: Live, send: (t: string) => Promise<void>) {
  const settings = await loadSettings();
  const questions = await loadServableQuestions();
  L.mastery = await loadMastery(L.userId);
  L.state = newSprintState(entryDifficulty(L.mastery, settings));
  L.webToken = crypto.randomBytes(12).toString("hex");
  const session = await createSession(L.userId, "sprint", L.webToken);
  L.sessionId = session.id;
  L.phase = "in_question";
  L.hintRung = 0;
  L.lastWrong = null;

  // XTrace-grounded greeting (RocketRide pipeline, template fallback)
  const ctx = await recallStudentContext(L.xtraceId);
  const greeting =
    (await tutorRespond({ intent: "greeting", studentContext: ctx })) ??
    (ctx ? `Welcome back. I remember where we left off — let's pick it up from there. 🎯` : `Hi, I'm Sage 🎯 Ten adaptive questions, at your pace. Difficulty follows how you do. Let's go.`);
  await send(greeting);

  await sendNextQuestion(L, send, settings.sessionLen);
}

async function sendNextQuestion(L: Live, send: (t: string) => Promise<void>, sessionLen: number) {
  const questions = await loadServableQuestions();
  const q = L.state!.history.length >= sessionLen ? null : pickQuestion(L.state!, questions, L.mastery);
  if (!q) return endSprint(L, send);
  L.current = q;
  L.qSentAt = Date.now();
  L.hintRung = 0;
  await send(questionCard(q, L.state!.history.length + 1, sessionLen));
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
  await updateSession(L.sessionId!, { current_question_id: q.qid, question_index: L.state!.history.length } as any).catch(() => {});

  if (result.correct) {
    let msg = `✓ Correct${secs ? ` — in ${secs}s` : ""}.${secs && secs <= 90 ? " Solid pace for test day." : ""}`;
    if (L.hintRung > 0) msg += ` (with ${L.hintRung} hint${L.hintRung > 1 ? "s" : ""} — counts toward mastery, not the staircase)`;
    if (result.adaptNote) msg += `\n⚖️ ${result.adaptNote}`;
    await send(msg);
    L.lastWrong = null;
  } else {
    const diagnosis = q.distractor_diagnoses?.[label];
    L.lastWrong = { q, answer: label };
    // RocketRide P2 pipeline: verdict grounded in rationale + diagnosis
    const verdict =
      (await tutorRespond({
        intent: "verdict", questionText: q.question,
        choices: q.choices.map((c) => `${c.label}) ${c.text}`).join(" "),
        studentAnswer: label, correctAnswer: q.correct, rationale: q.rationale ?? "", diagnosis,
      })) ?? `✗ Not quite — the answer is ${q.correct}.${diagnosis ? ` ${diagnosis}` : ""} Want me to walk through it? (reply "walk")`;
    await send(verdict.includes("walk") ? verdict : verdict + `\n\nWant the full walkthrough? Reply "walk".`);
    if (result.floorRuleFired) {
      recordStruggle(L.xtraceId, q.topic, `Two misses at difficulty 1 indicate a concept gap, not a difficulty problem.`);
      await send(`📚 Flagged ${topicName(q.topic)} for instruction — I'll bring a gentler on-ramp next time.`);
    }
    if (result.adaptNote && !result.floorRuleFired) await send(`⚖️ ${result.adaptNote}`);
    L.phase = "awaiting_walkthrough";
    return; // wait for walk / next / answer
  }
  await sendNextQuestion(L, send, settings.sessionLen);
}

async function endSprint(L: Live, send: (t: string) => Promise<void>) {
  const summary = summarize(L.state!);
  await updateSession(L.sessionId!, { state: "done", ended_at: new Date().toISOString(), score: summary.nCorrect } as any).catch(() => {});
  await recordSprintEpisode(L.xtraceId, L.sessionId!, summary, "sprint");
  const lines = [
    `🏁 Sprint complete: ${summary.nCorrect}/${summary.total}${summary.avgSecs ? ` · avg ${summary.avgSecs}s/q` : ""} · peak difficulty ${summary.peakDifficulty}/5`,
    summary.strengths.length ? `💪 Strong: ${summary.strengths.map(topicName).join(", ")}` : "",
    summary.gaps.length ? `🎯 Needs work: ${summary.gaps.map(topicName).join(", ")}` : "No gaps this sprint!",
    `Your full breakdown: ${WEB_BASE}/sprint.html?token=${L.webToken}`,
    `Text "start" anytime for another sprint.`,
  ].filter(Boolean);
  await send(lines.join("\n"));
  L.phase = "idle";
  L.current = null;
  L.state = null;
}

// ---------- message routing ----------
async function handleMessage(L: Live, text: string, send: (t: string) => Promise<void>) {
  const t = text.trim().toLowerCase();
  const settings = await loadSettings();

  if (["start", "go", "begin", "practice", "hi", "hello", "hey"].includes(t)) return startSprint(L, send);
  if (t === "stop") {
    if (L.sessionId) await updateSession(L.sessionId, { state: "done", ended_at: new Date().toISOString() } as any).catch(() => {});
    L.phase = "idle";
    return send(`Paused. Text "start" whenever you're ready.`);
  }

  if (L.phase === "in_question" && L.current) {
    const label = t.toUpperCase();
    if (["A", "B", "C", "D", "E"].includes(label)) return handleAnswer(L, label, send);
    if (t === "hint" || t.includes("stuck")) {
      const hints = L.current.hints ?? [];
      if (L.hintRung < hints.length) {
        const h = hints[L.hintRung++];
        return send(`💡 Hint ${L.hintRung}/3: ${h}`);
      }
      return send(`That's all three hints — take your best shot, A–E. A miss teaches us more than a skip.`);
    }
    if (t === "help") {
      return send(`Let's switch to the tutor room — same question, and you can talk to me there:\n${WEB_BASE}/sprint.html?token=${L.webToken}`);
    }
    if (t === "progress") {
      const done = L.state!.history.length;
      const right = L.state!.history.filter((h) => h.correct).length;
      return send(`${done}/${settings.sessionLen} answered, ${right} correct, difficulty ${L.state!.difficulty}/5.`);
    }
    // free-text during a question → grounded nudge, never the answer
    const reply = await tutorRespond({
      intent: "freeform", freeText: text,
      questionText: L.current.question,
      choices: L.current.choices.map((c) => `${c.label}) ${c.text}`).join(" "),
      rationale: L.current.rationale ?? "",
    });
    return send(reply ?? `Reply A–E when ready, or "hint" if you want a nudge.`);
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
      return sendNextQuestion(L, send, settings.sessionLen);
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

async function makeApp() {
  if (PROJECT_ID && PROJECT_SECRET) {
    const app = await Spectrum({
      projectId: PROJECT_ID,
      projectSecret: PROJECT_SECRET,
      providers: [terminal.config(), imessage.config()],
    });
    console.log("Sage up — terminal + iMessage providers active.");
    if (MY_PHONE) {
      try {
        const im = imessage(app);
        const me = await im.user(MY_PHONE);
        const space = await im.space(me);
        await space.send(`Sage here 🎓 Your adaptive quant tutor is live. Text "start" for a 10-question sprint.`);
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

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  const text = message.content.text;
  const senderId = message.sender?.id ?? "terminal-user";
  console.log(`[${message.platform}] ${senderId}: ${text}`);
  try {
    const L = await ensureLive(senderId);
    await handleMessage(L, text, async (t: string) => {
      await space.send(t);
    });
  } catch (e) {
    console.error("handler error:", e);
    await space.send("Hit a snag — give me a sec and try again.").catch(() => {});
  }
}
