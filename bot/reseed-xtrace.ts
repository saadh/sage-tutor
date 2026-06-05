import { MemoryClient } from "@xtraceai/memory";
const mem = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const xtraceId = `student-${process.env.MY_PHONE!.replace(/[^0-9a-zA-Z]/g, "")}`;
const claims = [
  "The student struggles with geometry; they missed all three geometry questions and worked slowly on them.",
  "The student is strong at percentages; they answer percentage questions correctly.",
  "The student is strong at algebra; they answer algebra questions correctly.",
];
for (const [i, content] of claims.entries()) {
  const job = await mem.memories.ingest({ messages: [{ role: "assistant", content }], user_id: xtraceId, conv_id: `seed2_${Date.now()}_${i}` });
  const done: any = await mem.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
  console.log(`[${i}]`, done.status, "created:", done.result?.memories_created?.length ?? 0);
}
for await (const m of mem.memories.list({ user_id: xtraceId, type: "fact" })) {
  console.log(`FACT[${(m as any).details?.status}] ${m.text.slice(0, 110)}`);
}
