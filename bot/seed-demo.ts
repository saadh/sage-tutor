/**
 * Demo seed fixture — "the struggling student from yesterday."
 * Creates a believable Session-1 history for MY_PHONE so the demo's
 * resume beat ("last time geometry gave you trouble") and the XTrace
 * belief-revision money shot always work.
 * Idempotent-ish: safe to re-run (new session each run; facts supersede).
 * Run: npm run seed:demo
 */
import { MemoryClient } from "@xtraceai/memory";

const BASE = process.env.BUTTERBASE_URL!;
const KEY = process.env.BUTTERBASE_API_KEY!;
const PHONE = process.env.MY_PHONE!;
const xtraceId = `student-${PHONE.replace(/[^0-9a-zA-Z]/g, "")}`;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : undefined;
}

// 1) user
const users = await api("GET", `/users?phone=eq.${encodeURIComponent(PHONE)}&limit=1`);
const user = users[0] ?? (await api("POST", "/users", { phone: PHONE, name: "Demo Student", verified_at: new Date().toISOString() }));
console.log("user:", user.id);

// 2) yesterday's session: 6/10, geometry was the problem
const yesterday = new Date(Date.now() - 86_400_000);
const session = await api("POST", "/sessions", { user_id: user.id, mode: "sprint", state: "done", score: 6, web_token: `seed-${Date.now()}` });
await api("PATCH", `/sessions/${session.id}`, { started_at: yesterday.toISOString(), ended_at: new Date(yesterday.getTime() + 1200_000).toISOString() });
console.log("session:", session.id);

// 3) attempts: geometry misses, percentages/algebra hits
const qs = await api("GET", "/questions?select=id,qid,topic,difficulty,correct&verified=is.true&needs_review=is.false&limit=1000");
const byTopic = (t: string, n: number) => qs.filter((q: any) => q.topic === t).slice(0, n);
const plan: [any, boolean, number][] = [];
for (const q of byTopic("geometry", 3)) plan.push([q, false, 140]);          // 3 geometry misses (slow)
for (const q of byTopic("percentages", 3)) plan.push([q, true, 75]);          // 3 percentage hits
for (const q of byTopic("algebra", 2)) plan.push([q, true, 80]);              // 2 algebra hits
for (const q of byTopic("speed-time-distance", 2)) plan.push([q, true, 95]);  // 2 std hits
for (const [q, correct, secs] of plan) {
  await api("POST", "/attempts", { session_id: session.id, question_id: q.id, qid: q.qid, answer: correct ? q.correct : (q.correct === "A" ? "B" : "A"), correct, latency_s: secs, surface: "imessage" });
}
console.log("attempts:", plan.length);

// 4) mastery rows (geometry weak, percentages solid)
const masterySeed = [
  { topic: "geometry", level: 1.4, attempts: 3, correct: 0 },
  { topic: "percentages", level: 2.8, attempts: 3, correct: 3 },
  { topic: "algebra", level: 2.6, attempts: 2, correct: 2 },
  { topic: "speed-time-distance", level: 2.4, attempts: 2, correct: 2 },
];
for (const m of masterySeed) {
  const existing = await api("GET", `/mastery?user_id=eq.${user.id}&topic=eq.${m.topic}&limit=1`);
  if (existing.length) await api("PATCH", `/mastery/${existing[0].id}`, m);
  else await api("POST", "/mastery", { user_id: user.id, ...m });
}
console.log("mastery seeded");

// 5) XTrace: yesterday's beliefs (present-state claims → facts; supersedable live)
const mem = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
// One belief per ingest (paragraphs collapse into un-supersedable blob facts)
const claims = [
  "The student struggles with geometry; they missed all three geometry questions and worked slowly on them.",
  "The student is strong at percentages; they answer percentage questions correctly.",
  "The student is strong at algebra; they answer algebra questions correctly.",
  "Practice sprint complete. The student scored 6 out of 10, averaging 98 seconds per question. The student should resume at difficulty 2 of 5.",
];
for (const [i, content] of claims.entries()) {
  const job = await mem.memories.ingest({
    messages: [{ role: "assistant", content }],
    user_id: xtraceId,
    conv_id: `seed_${Date.now()}_${i}`,
  });
  const done: any = await mem.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
  console.log(`xtrace[${i}]:`, done.status, "created:", done.result?.memories_created?.length ?? 0, "superseded:", done.result?.memories_superseded?.length ?? 0);
}
console.log("\nSEED COMPLETE — text 'start' and Sage should remember the geometry struggle.");
