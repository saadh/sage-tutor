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

/** Fire-and-forget struggle fact (floor rule / repeated misses). */
export function recordStruggle(user_id: string, topic: string, detail: string) {
  client.memories
    .ingest({
      messages: [
        { role: "assistant", content: `The student struggles with ${topicName(topic)}. ${detail}` },
      ],
      user_id,
      conv_id: `sage_live_${Date.now()}`,
    })
    .catch((e) => console.error("xtrace struggle ingest failed (non-fatal):", e));
}

/** End-of-sprint episode + belief updates. Present-state claims only. */
export async function recordSprintEpisode(
  user_id: string,
  sessionId: string,
  summary: SprintSummary,
  mode: string,
): Promise<void> {
  const claims: string[] = [];
  for (const t of summary.strengths) claims.push(`The student is strong at ${topicName(t)}; they answer ${topicName(t)} questions correctly.`);
  for (const t of summary.gaps) claims.push(`The student struggles with ${topicName(t)}.`);
  const narrative =
    `Practice sprint complete (${mode}). The student scored ${summary.nCorrect} out of ${summary.total}` +
    (summary.avgSecs ? `, averaging ${summary.avgSecs} seconds per question` : "") +
    `, reaching peak difficulty ${summary.peakDifficulty} of 5. ` +
    `The student should resume at difficulty ${summary.resumeDifficulty} of 5.`;
  try {
    const job = await client.memories.ingest({
      messages: [{ role: "assistant", content: [narrative, ...claims].join(" ") }],
      user_id,
      conv_id: `sage_sprint_${sessionId}`,
    });
    // Don't block the recap text on extraction; poll in background for logs.
    client.memories.jobs
      .pollUntilDone(job.id, { timeoutMs: 60_000 })
      .then((d: any) => {
        const r = d.result ?? {};
        console.log(
          `xtrace episode: created=${r.memories_created?.length ?? 0} superseded=${r.memories_superseded?.length ?? 0}`,
        );
      })
      .catch(() => {});
  } catch (e) {
    console.error("xtrace episode ingest failed (non-fatal):", e);
  }
}
