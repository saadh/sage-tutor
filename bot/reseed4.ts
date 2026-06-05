import { MemoryClient } from "@xtraceai/memory";
const mem = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const xtraceId = `student-${process.env.MY_PHONE!.replace(/[^0-9a-zA-Z]/g, "")}`;
const pairs: [string, string][] = [
  ["I am weak at geometry. Geometry is my worst topic — I get geometry questions wrong almost every time, including triangles and circles.",
   "Understood. You struggle with geometry — it is currently your weakest topic. We will focus practice there."],
];
for (const [i, [u, a]] of pairs.entries()) {
  const job = await mem.memories.ingest({
    messages: [{ role: "user", content: u }, { role: "assistant", content: a }],
    user_id: xtraceId, conv_id: `seed5_${Date.now()}_${i}`,
  });
  const done: any = await mem.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
  console.log(`[${i}]`, done.status, "created:", done.result?.memories_created?.length ?? 0);
}
console.log("--- all facts ---");
for await (const m of mem.memories.list({ user_id: xtraceId, type: "fact" })) {
  console.log(`FACT[${(m as any).details?.status}] ${m.text.slice(0, 110)}`);
}
