import { MemoryClient } from "@xtraceai/memory";
const client = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const user_id = "smoke-test-student";

const job = await client.memories.ingest({
  messages: [
    { role: "user", content: "Update on my percentage problems: I no longer struggle with identifying the base in percentage-change questions. I have fully mastered base identification now — I solved all of today's hard reverse-percentage problems correctly without hints." },
    { role: "assistant", content: "Confirmed: the student has mastered identifying the base in percentage-change questions. The earlier struggle with base identification is resolved as of session 2." },
  ],
  user_id,
  conv_id: `smoke_session_3_${Date.now()}`,
});
const done = await client.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
console.log("job:", done.status, JSON.stringify(done.result).slice(0, 400));

const all: any[] = [];
for await (const m of client.memories.list({ user_id })) all.push(m);
console.log(`\nmemories now: ${all.length}`);
for (const m of all) {
  console.log(`- [${m.details?.status}] supersedes=${m.details?.supersedes ? m.details.supersedes.slice(0,8) : "null"} :: ${m.text}`);
}

// revision chain of the original fact
const res = await fetch(`https://api.production.xtrace.ai/v1/memories/48d157ae-5147-4ccf-b45c-346d1c30a706/revisions`, {
  headers: { Authorization: `Bearer ${process.env.XTRACE_API_KEY}`, "X-Org-Id": process.env.XTRACE_ORG_ID! },
});
const chain = await res.json();
console.log(`\nrevision chain entries: ${chain.data?.length}`);
for (const m of chain.data ?? []) console.log(`- [${m.details?.status}] ${m.text.slice(0, 90)}`);
