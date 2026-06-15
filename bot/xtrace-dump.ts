/**
 * XTrace MEMORY dump for one student.
 * Lists every stored memory (facts + episodes), shows belief-revision chains
 * (the "superseded" history), and previews what Sage RECALLS at greeting time
 * via the same search the bot uses.
 *
 * The XTrace id is derived from the message sender:
 *   iMessage phone +966531490549  →  student-966531490549
 *   terminal chat                 →  student-terminaluser  (or whatever the
 *                                     bot logs as "[terminal] <id>:")
 *
 *   npm run xtrace:dump                          # defaults to MY_PHONE's id
 *   npm run xtrace:dump -- student-966531490549
 *   npm run xtrace:dump -- student-terminaluser
 */
import { MemoryClient } from "@xtraceai/memory";

const client = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const arg = process.argv.slice(2).join(" ").trim();
const user_id = arg || `student-${(process.env.MY_PHONE ?? "").replace(/[^0-9a-zA-Z]/g, "")}`;
console.log(`XTrace user_id: ${user_id}\n`);

// 1) every stored memory
const all: any[] = [];
for await (const m of client.memories.list({ user_id })) all.push(m);
console.log(`STORED MEMORIES: ${all.length}`);
for (const m of all) {
  console.log(`  [${m.type}/${(m as any).details?.status ?? "active"}] ${m.text}`);
}

// 2) belief-revision chains (the demo "money shot")
console.log(`\nBELIEF REVISIONS (chains longer than 1 = a belief was superseded):`);
let anyChain = false;
for (const m of all) {
  const res = await fetch(`https://api.production.xtrace.ai/v1/memories/${m.id}/revisions`, {
    headers: { Authorization: `Bearer ${process.env.XTRACE_API_KEY}`, "X-Org-Id": process.env.XTRACE_ORG_ID! },
  });
  if (!res.ok) continue;
  const data: any = await res.json();
  const revs: any[] = data.revisions ?? data.data ?? data ?? [];
  if (Array.isArray(revs) && revs.length > 1) {
    anyChain = true;
    console.log(`  • ${m.text.slice(0, 60)}`);
    for (const r of revs) console.log(`      [${r.status ?? "?"}] ${(r.text ?? "").slice(0, 80)}`);
  }
}
if (!anyChain) console.log("  (none yet — these appear after a topic flips weak→strong across sprints)");

// 3) what the bot would recall at greeting
console.log(`\nGREETING RECALL (what Sage reads before saying hello):`);
try {
  const res: any = await client.memories.search({
    query: "what does this student struggle with, and what are their strengths and recent progress?",
    user_id, limit: 5,
  } as any);
  const items: any[] = res.results ?? res.data ?? [];
  if (items.length) for (const m of items) console.log(`  - ${m.text}`);
  else console.log("  (nothing recalled — no memories for this id yet)");
} catch (e: any) {
  console.error("  recall failed:", e?.message);
}
process.exit(0);
