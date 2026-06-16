/**
 * RocketRide tutor-pipeline client.
 * Loads pipelines/sage-tutor.pipe once and exposes tutorRespond() — the
 * P2 pipeline call that turns (question, answer, diagnosis, rationale)
 * into Sage's teaching response. LLM inside the pipeline = Butterbase
 * gateway; agent has xtrace recall tool attached.
 */
import { RocketRideClient, Question } from "rocketride";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./db.ts";

const AGENT_PIPE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../pipelines/sage-tutor.pipe");
const FAST_PIPE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../pipelines/sage-hello.pipe");

let client: RocketRideClient | null = null;
let token: string | null = null; // agent pipeline (xtrace tools, deep work — P3 summaries)
let fastToken: string | null = null; // single-hop gateway LLM (hot-path tutoring)

export async function initTutorPipeline(xtraceUserId: string): Promise<boolean> {
  try {
    client = new RocketRideClient({
      uri: process.env.ROCKETRIDE_URI ?? "ws://localhost:5565",
      auth: process.env.ROCKETRIDE_APIKEY ?? "sage-local-dev",
      module: "SAGE-TUTOR",
      persist: true,
      maxRetryTime: 60_000,
      env: {
        ...(process.env as Record<string, string>),
        ROCKETRIDE_XTRACE_API_KEY: process.env.XTRACE_API_KEY ?? "",
        ROCKETRIDE_XTRACE_ORG_ID: process.env.XTRACE_ORG_ID ?? "",
        ROCKETRIDE_SAGE_USER_ID: xtraceUserId,
      },
    });
    await client.connect();
    const res = await client.use({ filepath: AGENT_PIPE });
    token = res.token;
    const fastRes = await client.use({ filepath: FAST_PIPE });
    fastToken = fastRes.token;
    console.log("✓ RocketRide pipelines loaded — agent:", String(token).slice(0, 12) + "… fast:", String(fastToken).slice(0, 12) + "…");
    return true;
  } catch (e) {
    console.error("RocketRide pipeline init failed (tutor falls back to gateway-direct):", e);
    client = null;
    token = null;
    fastToken = null;
    return false;
  }
}

export interface TutorContext {
  intent: "verdict" | "walkthrough" | "greeting" | "freeform";
  questionText?: string;
  choices?: string;
  studentAnswer?: string;
  correctAnswer?: string;
  rationale?: string;
  diagnosis?: string;
  studentContext?: string | null;
  freeText?: string;
}

const PERSONA = "You are Sage, a warm, brief GMAT/GRE quant tutor texting over iMessage. Ground everything in the provided verified rationale — never invent alternative solution paths. Be direct and helpful: answer the student's question or give the next concrete step. Do NOT repeatedly quiz the student or demand they explain their reasoning — at most one short follow-up question, and only if it helps. If the student seems done, frustrated, or wants to move on, give a brief plain explanation and stop. HARD LIMIT: at most 3 short sentences / 50 words.";

/** Build the (context, ask) prompt for an intent — shared by both backends. */
function buildPrompt(ctx: TutorContext): { context: string; ask: string } {
  if (ctx.intent === "verdict") {
    return {
      context: `QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nSTUDENT ANSWERED: ${ctx.studentAnswer} (WRONG)\nCORRECT: ${ctx.correctAnswer}\nVERIFIED RATIONALE: ${ctx.rationale}\nDISTRACTOR DIAGNOSIS: ${ctx.diagnosis ?? "n/a"}`,
      ask: "In 2 short sentences: name the specific error (use the diagnosis), then offer a walkthrough.",
    };
  }
  if (ctx.intent === "walkthrough") {
    return {
      context: `QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nSTUDENT ANSWERED: ${ctx.studentAnswer}\nCORRECT: ${ctx.correctAnswer}\nVERIFIED RATIONALE: ${ctx.rationale}`,
      ask: ctx.freeText
        ? `Student asked: "${ctx.freeText}". Answer from the rationale in 2-3 short sentences.`
        : "Walk through the solution from the rationale: the 3-4 key steps, one short sentence each. End with: did that click?",
    };
  }
  if (ctx.intent === "greeting") {
    return {
      context: `STUDENT HISTORY (from memory):\n${ctx.studentContext ?? "(new student, no history)"}`,
      ask: "Greet the student in 1-2 warm sentences to open a sprint. Reference a struggle topic from history if present. One emoji max.",
    };
  }
  // freeform: the student is talking through the CURRENT question (e.g. after a hint)
  return {
    context: ctx.questionText
      ? `CURRENT QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nRATIONALE (use to guide, but NEVER reveal the answer): ${ctx.rationale}`
      : "",
    ask: `Student said: "${ctx.freeText ?? ""}". Give one short, concrete piece of help toward the next step. If they're right so far, confirm and point to what's next. Don't interrogate them. Never reveal the answer or which option is correct.`,
  };
}

export async function tutorRespond(ctx: TutorContext): Promise<string | null> {
  const { context, ask } = buildPrompt(ctx);
  // Preferred path: the FAST RocketRide pipeline (single gateway hop).
  if (client && fastToken) {
    try {
      const q = new Question();
      q.addContext(PERSONA);
      if (context) q.addContext(context);
      q.addQuestion(ask);
      const response: any = await client.chat({ token: fastToken, question: q });
      const ans = response?.data?.answer ?? response?.answers?.[0] ?? (Array.isArray(response) ? response[0] : null);
      if (typeof ans === "string" && ans.trim()) return ans;
    } catch (e) {
      console.error("tutor pipeline call failed — falling back to gateway:", e);
    }
  }
  // Fallback: call the Butterbase AI gateway directly (works when RocketRide is
  // unavailable — same model, no agent loop). This is what makes hint/walkthrough
  // engagement work in the iMessage thread today.
  try {
    const out = await chat(
      [{ role: "system", content: PERSONA }, { role: "user", content: `${context}\n\n---\n${ask}`.trim() }],
      { max_tokens: 220, temperature: 0.4 },
    );
    return out?.trim() || null;
  } catch (e) {
    console.error("tutor gateway fallback failed:", e);
    return null;
  }
}

/** Deep/async work (P3 session summaries) — the agent pipeline with xtrace tools. */
export async function agentRespond(prompt: string): Promise<string | null> {
  if (!client || !token) return null;
  try {
    const q = new Question();
    q.addQuestion(prompt);
    const response: any = await client.chat({ token, question: q });
    const ans = response?.data?.answer ?? response?.answers?.[0] ?? (Array.isArray(response) ? response[0] : null);
    return typeof ans === "string" ? ans : null;
  } catch (e) {
    console.error("agent pipeline call failed:", e);
    return null;
  }
}

export async function shutdownTutor() {
  try {
    if (client && token) await client.terminate(token);
    if (client) await client.disconnect();
  } catch {}
}
