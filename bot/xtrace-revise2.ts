import { MemoryClient } from "@xtraceai/memory";
const client = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const user_id = "smoke-test-student";

const job = await client.memories.ingest({
  messages: [
    { role: "user", content: "I find identifying the base in percentage-change questions easy now. Base identification is one of my strengths." },
    { role: "assistant", content: "Great — base identification in percentage-change questions is a strength for you now." },
  ],
  user_id,
  conv_id: `smoke_session_4_${Date.now()}`,
});
const done = await client.memories.jobs.pollUntilDone(job.id, { timeoutMs: 90_000 });
const r: any = done.result;
console.log("created:", r?.memories_created?.length, "updated:", r?.memories_updated?.length, "superseded:", JSON.stringify(r?.memories_superseded)?.slice(0,300));

const all: any[] = [];
for await (const m of client.memories.list({ user_id, type: "fact" })) all.push(m);
console.log(`\nfacts now: ${all.length}`);
for (const m of all) console.log(`- [${m.details?.status}] supersedes=${m.details?.supersedes?.slice(0,8) ?? "null"} :: ${m.text.slice(0,100)}`);

const res = await fetch(`https://api.production.xtrace.ai/v1/memories/48d157ae-5147-4ccf-b45c-346d1c30a706/revisions`, {
  headers: { Authorization: `Bearer ${process.env.XTRACE_API_KEY}`, "X-Org-Id": process.env.XTRACE_ORG_ID! },
});
const chain = await res.json();
console.log(`\nrevision chain: ${chain.data?.length} entries`);
for (const m of chain.data ?? []) console.log(`- [${m.details?.status}] ${m.text.slice(0,90)}`);
