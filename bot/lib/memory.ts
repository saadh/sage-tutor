/**
 * XTrace memory wrapper for Sage.
 * Phrasing rule (proven in smoke test): write PRESENT-STATE factual claims,
 * one belief per sentence — that triggers fact extraction + automatic
 * supersede of contradicting old beliefs. "Update:" phrasing becomes
 * artifacts and never supersedes.
 */
import { MemoryClient } from "@xtraceai/memory";
import type { SprintSummary } from "./engine.ts";

const client = new MemoryClient({
  apiKey: process.env.XTRACE_API_KEY!,
  orgId: process.env.XTRACE_ORG_ID!,
});

const topicName = (t: string) => t.replace(/-/g, " ");

/** Greeting context: what should Sage know before saying hello? */
export async function recallStudentContext(user_id: string): Promise<string | null> {
  try {
    const res: any = await client.memories.search({
      query: "what does this student struggle with, and what are their strengths and recent progress?",
      user_id,
      limit: 5,
    } as any);
    const items: any[] = res.results ?? res.data ?? [];
    if (!items.length) return null;
    return items
      .filter((m) => m.text)
      .slice(0, 4)
      .map((m) => `- ${m.text}`)
      .join("\n");
  } catch (e) {
    console.error("xtrace recall failed (non-fatal):", e);
    return null;
  }
}

/** Fire-and-forget struggle fact (floor rule / repeated misses).
 *  Extraction findings: dialogue pairs + emphatic specific phrasing extract
 *  reliably; assistant-only third-person paragraphs often extract nothing. */
export function recordStruggle(user_id: string, topic: string, detail: string) {
  const t = topicName(topic);
  client.memories
    .ingest({
      messages: [
        { role: "user", content: `I am weak at ${t}. I keep getting ${t} questions wrong. ${detail}` },
        { role: "assistant", content: `Understood — you struggle with ${t}; it is currently a weak topic for you. We'll focus practice there.` },
      ],
      user_id,
      conv_id: `sage_live_${Date.now()}`,
    })
    .catch((e) => console.error("xtrace struggle ingest failed (non-fatal):", e));
}

/** End-of-sprint episode + belief updates.
 *  CRITICAL (seed-fixture finding): one belief per INGEST call — paragraph
 *  ingests collapse into a single blob fact that can never be superseded
 *  claim-by-claim. Separate ingests → separate facts → clean belief revision. */
export async function recordSprintEpisode(
  user_id: string,
  sessionId: string,
  summary: SprintSummary,
  mode: string,
): Promise<void> {
  const pairs: { u: string; a: string; tag: string }[] = [];
  for (const t of summary.strengths) {
    const n = topicName(t);
    pairs.push({
      u: `${n} felt strong today — I answered every ${n} question correctly.`,
      a: `Confirmed — you are strong at ${n}; you answer ${n} questions correctly now.`,
      tag: `strength-${t}`,
    });
  }
  for (const t of summary.gaps) {
    const n = topicName(t);
    pairs.push({
      u: `I am weak at ${n}. I keep getting ${n} questions wrong.`,
      a: `Understood — you struggle with ${n}; it is currently a weak topic for you. We'll focus practice there.`,
      tag: `gap-${t}`,
    });
  }
  pairs.push({
    u: `How did my sprint go overall?`,
    a:
      `Sprint complete (${mode}): you scored ${summary.nCorrect} out of ${summary.total}` +
      (summary.avgSecs ? `, averaging ${summary.avgSecs} seconds per question` : "") +
      `, reaching peak difficulty ${summary.peakDifficulty} of 5. You should resume at difficulty ${summary.resumeDifficulty} of 5.`,
    tag: "episode",
  });
  const ingestOne = async (p: { u: string; a: string; tag: string }) => {
    try {
      const job = await client.memories.ingest({
        messages: [{ role: "user", content: p.u }, { role: "assistant", content: p.a }],
        user_id,
        conv_id: `sage_sprint_${sessionId}_${p.tag}`,
      });
      client.memories.jobs
        .pollUntilDone(job.id, { timeoutMs: 60_000 })
        .then((d: any) => {
          const r = d.result ?? {};
          console.log(`xtrace[${p.tag}]: created=${r.memories_created?.length ?? 0} superseded=${r.memories_superseded?.length ?? 0}`);
        })
        .catch(() => {});
    } catch (e) {
      console.error(`xtrace ingest[${p.tag}] failed (non-fatal):`, e);
    }
  };
  await Promise.all(pairs.map(ingestOne));
}
