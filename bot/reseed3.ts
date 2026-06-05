import { MemoryClient } from "@xtraceai/memory";
const mem = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const xtraceId = `student-${process.env.MY_PHONE!.replace(/[^0-9a-zA-Z]/g, "")}`;

// dialogue pairs — the extraction shape PROVEN in the smoke test
const pairs: [string, string][] = [
  ["Geometry keeps tripping me up. I missed all three geometry questions today and was slow on every one of them.",
   "Noted — you struggle with geometry right now. We'll warm up there next session."],
  ["Percentages felt easy today — I got every percentage question right.",
   "Confirmed — you are strong at percentages; you answer them correctly."],
  ["Algebra went well too, I answered both algebra questions correctly.",
   "Great — you are strong at algebra."],
];
for (const [i, [u, a]] of pairs.entries()) {
  const job = await mem.memories.ingest({
    messages: [{ role: "user", content: u }, { role: "assistant", content: a }],
    user_id: xtraceId, conv_id: `seed4_${Date.now()}_${i}`,
  });
  const done: any = await mem.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
  console.log(`[${i}]`, done.status, "created:", done.result?.memories_created?.length ?? 0);
}
for await (const m of mem.memories.list({ user_id: xtraceId, type: "fact" })) {
  console.log(`FACT[${(m as any).details?.status}] ${m.text.slice(0, 110)}`);
}
