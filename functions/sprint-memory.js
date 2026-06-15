/**
 * Sage sprint-memory — Butterbase function.
 * Writes a finished web sprint into XTrace as present-state belief facts +
 * an episode, mirroring bot/lib/memory.ts (recordSprintEpisode) so the web
 * channel feeds the same memory the iMessage bot does. The XTrace API key
 * lives here as an encrypted server-side secret — never in the browser.
 *
 * POST body: { user_id, mode, summary: { sessionId, nCorrect, total, avgSecs,
 *              peakDifficulty, resumeDifficulty, strengths[], gaps[] } }
 */
export default async function handler(req, ctx) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const { user_id, mode, summary } = body;
  if (!user_id || !summary) {
    return new Response(JSON.stringify({ error: "user_id and summary required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const KEY = ctx.env.XTRACE_API_KEY, ORG = ctx.env.XTRACE_ORG_ID;
  if (!KEY || !ORG) {
    return new Response(JSON.stringify({ error: "xtrace not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const tn = (t) => String(t).replace(/-/g, " ");
  // One belief per ingest call — paragraph ingests collapse into a single blob
  // fact that can never be superseded claim-by-claim (seed-fixture finding).
  const pairs = [];
  for (const t of summary.strengths ?? []) {
    const n = tn(t);
    pairs.push({ u: `${n} felt strong today — I answered every ${n} question correctly.`, a: `Confirmed — you are strong at ${n}; you answer ${n} questions correctly now.`, tag: `strength-${t}` });
  }
  for (const t of summary.gaps ?? []) {
    const n = tn(t);
    pairs.push({ u: `I am weak at ${n}. I keep getting ${n} questions wrong.`, a: `Understood — you struggle with ${n}; it is currently a weak topic for you. We'll focus practice there.`, tag: `gap-${t}` });
  }
  pairs.push({
    u: `How did my sprint go overall?`,
    a: `Sprint complete (${mode || "sprint"}): you scored ${summary.nCorrect} out of ${summary.total}` +
       (summary.avgSecs ? `, averaging ${summary.avgSecs} seconds per question` : "") +
       `, reaching peak difficulty ${summary.peakDifficulty} of 5. You should resume at difficulty ${summary.resumeDifficulty} of 5.`,
    tag: "episode",
  });

  let written = 0;
  const errors = [];
  for (const p of pairs) {
    try {
      const r = await fetch("https://api.production.xtrace.ai/v1/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "X-Org-Id": ORG },
        body: JSON.stringify({
          messages: [{ role: "user", content: p.u }, { role: "assistant", content: p.a }],
          user_id,
          conv_id: `sage_web_${summary.sessionId || "x"}_${p.tag}`,
          extract_artifacts: true,
        }),
      });
      if (r.ok) written++;
      else errors.push(`${p.tag}:${r.status}:${(await r.text()).slice(0, 80)}`);
    } catch (e) {
      errors.push(`${p.tag}:err:${e?.message ?? e}`);
    }
  }
  return new Response(JSON.stringify({ ok: true, written, total: pairs.length, errors }), { headers: { "Content-Type": "application/json" } });
}
