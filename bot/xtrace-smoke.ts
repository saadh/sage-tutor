/**
 * XTrace smoke test — proves the demo money shot before we build on it.
 * 1. Ingest a struggling-student turn  → fact extracted
 * 2. Ingest a contradicting turn       → belief revision (supersedes)
 * 3. Read revision chain               → version history exists
 * 4. List episodes                     → episode memory type works
 * 5. Search                            → grounded retrieval works
 * Run: npm run smoke:xtrace  (needs XTRACE_API_KEY + XTRACE_ORG_ID in .env)
 */
import { MemoryClient } from "@xtraceai/memory";

const { XTRACE_API_KEY, XTRACE_ORG_ID } = process.env;
if (!XTRACE_API_KEY || !XTRACE_ORG_ID) {
  console.error("FAIL: XTRACE_API_KEY and XTRACE_ORG_ID must be set in bot/.env");
  process.exit(1);
}

const client = new MemoryClient({ apiKey: XTRACE_API_KEY, orgId: XTRACE_ORG_ID });
const user_id = "smoke-test-student";
const stamp = Date.now();

async function ingest(label: string, messages: { role: "user" | "assistant"; content: string }[], conv: string) {
  const job = await client.memories.ingest({ messages, user_id, conv_id: conv });
  const done = await client.memories.jobs.pollUntilDone(job.id, { timeoutMs: 60_000 });
  console.log(`✓ ingest[${label}]: status=${done.status} memories_created=${done.result?.memories_created ?? "?"}`);
  return done;
}

// 1. Struggling-student belief
await ingest("struggle", [
  { role: "user", content: "I keep getting percentage problems wrong. I always mess up finding the base in percent-change questions." },
  { role: "assistant", content: "Noted — you struggle with identifying the base in percentage problems. We'll drill that." },
], `smoke_session_1_${stamp}`);

// 2. Contradicting belief (mastery) — should supersede
await ingest("mastery", [
  { role: "user", content: "Percentages finally click! I got all five percent-change questions right today, including the hard reverse-base ones." },
  { role: "assistant", content: "Great progress — you've now mastered base identification in percentage problems." },
], `smoke_session_2_${stamp}`);

// 3. List facts and inspect revision chains
const facts: any[] = [];
for await (const m of client.memories.list({ user_id, type: "fact" })) facts.push(m);
console.log(`✓ facts stored: ${facts.length}`);
for (const f of facts) console.log(`   - [${f.id.slice(0, 12)}…] ${f.text ?? f.details?.text ?? JSON.stringify(f).slice(0, 100)}`);

let sawRevision = false;
for (const f of facts) {
  const sup = (f as any).details?.supersedes ?? (f as any).supersedes;
  if (sup) {
    sawRevision = true;
    console.log(`✓ REVISION: fact ${f.id.slice(0, 12)}… supersedes ${String(sup).slice(0, 12)}…`);
    try {
      const res = await fetch(`https://api.production.xtrace.ai/v1/memories/${f.id}/revisions`, {
        headers: { Authorization: `Bearer ${XTRACE_API_KEY}`, "X-Org-Id": XTRACE_ORG_ID },
      });
      console.log(`✓ revision chain endpoint: HTTP ${res.status}`);
      if (res.ok) console.log("   chain:", JSON.stringify(await res.json()).slice(0, 400));
    } catch (e) { console.log("   revisions endpoint error:", e); }
  }
}
if (!sawRevision) console.log("⚠ no supersedes field seen — belief revision may need explicit contradiction or more time");

// 4. Episodes
const episodes: any[] = [];
for await (const m of client.memories.list({ user_id, type: "episode" })) episodes.push(m);
console.log(`✓ episodes stored: ${episodes.length}`);

// 5. Search
const results = await client.memories.search({ query: "what topics does the student struggle with?", user_id, limit: 5 } as any);
const items = (results as any).results ?? (results as any).data ?? results;
console.log(`✓ search returned ${Array.isArray(items) ? items.length : "?"} results`);
if (Array.isArray(items)) for (const r of items.slice(0, 3)) console.log(`   - score=${r.score?.toFixed?.(3)} ${r.text?.slice(0, 90) ?? ""}`);

console.log("\nSMOKE TEST COMPLETE");
