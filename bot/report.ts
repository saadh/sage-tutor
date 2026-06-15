/**
 * Butterbase HISTORY report for one student.
 * Prints their account, every sprint, every answered question, per-topic
 * mastery, and the difficulty the engine will start their NEXT sprint at
 * (computed by the real bot code — lib/engine.ts entryDifficulty).
 *
 *   npm run report -- you@email.com
 *   npm run report -- +966531490549
 *   npm run report -- "Alex"
 */
import { loadSettings, loadMastery } from "./lib/db.ts";
import { entryDifficulty, pickTopic, type MasteryRow } from "./lib/engine.ts";

const BASE = process.env.BUTTERBASE_URL!;
const KEY = process.env.BUTTERBASE_API_KEY!;
const q = async <T = any>(p: string): Promise<T> =>
  fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.json());

const arg = process.argv.slice(2).join(" ").trim();
if (!arg) { console.error("usage: npm run report -- <email | phone | name>"); process.exit(1); }

let filter: string;
if (arg.includes("@")) filter = `email=eq.${encodeURIComponent(arg)}`;
else if (/^\+?[0-9][0-9 ()\-]*$/.test(arg)) filter = `phone=eq.${encodeURIComponent(arg.replace(/[^0-9+]/g, ""))}`;
else filter = `name=eq.${encodeURIComponent(arg)}`;

const users = await q<any[]>(`/users?${filter}&order=created_at.desc&limit=10`);
if (!users.length) { console.log(`No user found for "${arg}".`); process.exit(0); }
if (users.length > 1) console.log(`(${users.length} accounts match "${arg}" — showing each)\n`);

// qid → topic map (attempts store qid, not topic)
const qrows = await q<any[]>(`/questions?select=qid,topic&limit=1000`);
const topicOf = new Map(qrows.map((r) => [r.qid, r.topic]));
const settings = await loadSettings();
const pad = (s: any, n: number) => String(s).padEnd(n);

for (const u of users) {
  console.log("═".repeat(66));
  console.log(`USER  ${u.name ?? "(no name)"}   id=${u.id}`);
  console.log(`      phone=${u.phone}  email=${u.email ?? "—"}  created=${u.created_at?.slice(0, 16)}`);

  // ---- MASTERY (the "past performance" store the engine reads) ----
  const mastery = await loadMastery(u.id);
  console.log(`\nMASTERY  (${mastery.size} topics)`);
  if (mastery.size) {
    console.log(`  ${pad("topic", 24)}${pad("level", 7)}${pad("attempts", 10)}${pad("correct", 9)}accuracy`);
    for (const m of [...mastery.values()].sort((a, b) => a.level - b.level)) {
      const accPct = m.attempts ? Math.round((m.correct / m.attempts) * 100) + "%" : "—";
      console.log(`  ${pad(m.topic, 24)}${pad(m.level.toFixed(2), 7)}${pad(m.attempts, 10)}${pad(m.correct, 9)}${accPct}`);
    }
    // ↓ this is "deliver questions based on past performance", straight from the real engine
    console.log(`\n  → Next sprint STARTS at difficulty ${entryDifficulty(mastery as any, settings)}/5 (avg of mastery levels).`);
    const weak = [...mastery.entries()].sort((a, b) => (a[1].correct / (a[1].attempts || 1)) - (b[1].correct / (b[1].attempts || 1)))[0];
    if (weak) console.log(`  → Topic selection biases toward weakest: e.g. "${weak[0]}" (${Math.round((weak[1].correct / (weak[1].attempts || 1)) * 100)}% acc).`);
  } else {
    console.log(`  (none yet — first sprint will start at default difficulty ${settings.defaultEntryLevel}/5)`);
  }

  // ---- SESSIONS + ATTEMPTS (the exercise history) ----
  const sessions = await q<any[]>(`/sessions?user_id=eq.${u.id}&order=started_at.desc&limit=50`);
  console.log(`\nSPRINTS  (${sessions.length})`);
  for (const s of sessions) {
    const attempts = await q<any[]>(`/attempts?session_id=eq.${s.id}&order=ts.asc&limit=100`);
    const nC = attempts.filter((a) => a.correct).length;
    console.log(`\n  • ${s.mode}  ${s.state}  score=${s.score ?? nC}/${attempts.length}  ${(s.started_at ?? "").slice(0, 16)}  session=${s.id.slice(0, 8)}`);
    for (const a of attempts) {
      const mark = a.correct ? "✓" : "✗";
      console.log(`      ${mark} ${pad(topicOf.get(a.qid) ?? "?", 22)} ${pad(a.qid, 18)} ans=${a.answer}  hints=${a.hint_count ?? 0}  ${a.latency_s ?? "?"}s  [${a.surface ?? "?"}]`);
    }
  }

  // ---- NUDGES (Photon follow-ups) ----
  const nudges = await q<any[]>(`/nudges?user_id=eq.${u.id}&order=sent_at.desc&limit=20`);
  if (nudges.length) {
    console.log(`\nNUDGES  (${nudges.length})`);
    for (const n of nudges) console.log(`  • ${(n.sent_at ?? "").slice(0, 16)}  ${n.trigger_type}: ${n.body?.slice(0, 70)}`);
  }
  console.log("");
}
process.exit(0);
