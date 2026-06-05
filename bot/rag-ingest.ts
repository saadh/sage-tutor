/** Ingest per-topic rationale corpora into Butterbase RAG (collection: rationales).
 *  Grounds walkthroughs and micro-lessons. Run once: npm run rag:ingest */
import { createClient } from "@butterbase/sdk";
import { readFileSync } from "node:fs";

const bb = createClient({
  appId: "app_7m70nwelqpk6",
  apiUrl: "https://api.butterbase.ai",
  apiKey: process.env.BUTTERBASE_API_KEY!,
} as any);

const qs = JSON.parse(readFileSync(new URL("../data/questions.json", import.meta.url), "utf8"));
const servable = qs.filter((q: any) => q.verified && !q.needs_review);
const byTopic = new Map<string, any[]>();
for (const q of servable) {
  if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
  byTopic.get(q.topic)!.push(q);
}

let ok = 0;
for (const [topic, items] of [...byTopic.entries()].sort()) {
  const text = [
    `# ${topic.replace(/-/g, " ")} — worked solutions corpus`,
    ...items.map((q: any) => `## ${q.id}\nPROBLEM: ${q.question}\nSOLUTION: ${q.rationale ?? ""}`),
  ].join("\n\n");
  try {
    const doc: any = await (bb as any).rag.ingest("rationales", { text, filename: `${topic}.md`, metadata: { topic } });
    ok++;
    console.log(`${topic}: ${items.length} solutions → ${String(doc?.id ?? "ok").slice(0, 8)}`);
  } catch (e: any) {
    console.log(`${topic}: FAILED ${e?.message ?? e}`);
  }
}
console.log(`\ningested ${ok}/${byTopic.size} topic corpora`);
