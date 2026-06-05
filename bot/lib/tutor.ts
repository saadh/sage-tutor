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

const PIPE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../pipelines/sage-tutor.pipe");

let client: RocketRideClient | null = null;
let token: string | null = null;

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
    const res = await client.use({ filepath: PIPE });
    token = res.token;
    console.log("✓ RocketRide tutor pipeline loaded:", String(token).slice(0, 12) + "…");
    return true;
  } catch (e) {
    console.error("RocketRide pipeline init failed (tutor falls back to gateway-direct):", e);
    client = null;
    token = null;
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

export async function tutorRespond(ctx: TutorContext): Promise<string | null> {
  if (!client || !token) return null;
  try {
    const q = new Question();
    if (ctx.intent === "verdict") {
      q.addContext(`QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nSTUDENT ANSWERED: ${ctx.studentAnswer} (WRONG)\nCORRECT: ${ctx.correctAnswer}\nVERIFIED RATIONALE: ${ctx.rationale}\nDISTRACTOR DIAGNOSIS: ${ctx.diagnosis ?? "n/a"}`);
      q.addQuestion("In 2 short sentences: name the specific error the student made (use the diagnosis), then offer to walk through it. Do not solve the full problem yet.");
    } else if (ctx.intent === "walkthrough") {
      q.addContext(`QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nSTUDENT ANSWERED: ${ctx.studentAnswer}\nCORRECT: ${ctx.correctAnswer}\nVERIFIED RATIONALE: ${ctx.rationale}`);
      if (ctx.freeText) q.addQuestion(`The student asked during the walkthrough: "${ctx.freeText}". Answer grounded in the rationale, briefly, then continue the walkthrough.`);
      else q.addQuestion("Walk the student through the solution step by step from the rationale. Short sentences. End with: did that click?");
    } else if (ctx.intent === "greeting") {
      q.addContext(`STUDENT HISTORY (from memory):\n${ctx.studentContext ?? "(new student, no history)"}`);
      q.addQuestion("Greet the student in 1-2 warm sentences to open a practice sprint. If history shows a struggle topic, reference it naturally and say we'll warm up there. No emoji spam — one max.");
    } else {
      if (ctx.questionText) q.addContext(`CURRENT QUESTION: ${ctx.questionText}\nCHOICES: ${ctx.choices}\nRATIONALE (never reveal the final answer directly): ${ctx.rationale}`);
      q.addQuestion(ctx.freeText ?? "");
    }
    const response: any = await client.chat({ token, question: q });
    const ans = response?.data?.answer ?? response?.answers?.[0] ?? (Array.isArray(response) ? response[0] : null);
    return typeof ans === "string" ? ans : ans ? JSON.stringify(ans) : null;
  } catch (e) {
    console.error("tutor pipeline call failed:", e);
    return null;
  }
}

export async function shutdownTutor() {
  try {
    if (client && token) await client.terminate(token);
    if (client) await client.disconnect();
  } catch {}
}
