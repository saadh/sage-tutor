import { MemoryClient } from "@xtraceai/memory";
const client = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const user_id = "smoke-test-student";

// 1. ALL memories, full detail
const all: any[] = [];
for await (const m of client.memories.list({ user_id })) all.push(m);
console.log(`total memories: ${all.length}`);
for (const m of all) {
  console.log(JSON.stringify(m, null, 1).slice(0, 800));
  console.log("----");
}

// 2. Revisions endpoint on each
for (const m of all) {
  const res = await fetch(`https://api.production.xtrace.ai/v1/memories/${m.id}/revisions`, {
    headers: { Authorization: `Bearer ${process.env.XTRACE_API_KEY}`, "X-Org-Id": process.env.XTRACE_ORG_ID! },
  });
  console.log(`revisions[${m.id.slice(0,8)}]: HTTP ${res.status}`);
  if (res.ok) console.log(JSON.stringify(await res.json(), null, 1).slice(0, 600));
}
