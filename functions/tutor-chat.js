/**
 * Sage tutor-chat — Butterbase function.
 * The web tutor room's LLM brain: walkthroughs and free-text Q&A,
 * grounded in the verified rationale. Calls the AI Model Gateway
 * server-side so no key ever reaches the browser.
 */
export default async function handler(req, ctx) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const { mode, question, choices, studentAnswer, correctAnswer, rationale, diagnosis, userText, history } = body;

  // RAG grounding: open chat questions with no rationale in context get
  // grounded in the verified solutions corpus (per-topic worked rationales).
  let ragBlock = "";
  if (mode === "chat" && userText && !rationale) {
    try {
      const rr = await fetch(`https://api.butterbase.ai/v1/${ctx.env.APP_ID}/rag/collections/rationales/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.GATEWAY_KEY}` },
        body: JSON.stringify({ query: userText, top_k: 3 }),
      });
      if (rr.ok) {
        const data = await rr.json();
        const chunks = (data.chunks ?? []).filter((c) => c.score > 0.3);
        if (chunks.length) ragBlock = "RELEVANT WORKED SOLUTIONS (verified corpus):\n" + chunks.map((c) => c.content.slice(0, 600)).join("\n---\n");
      }
    } catch {}
  }


  const system = [
    "You are Sage, a warm, brief GMAT/GRE quant tutor. Short sentences. No corporate filler.",
    "Ground EVERYTHING in the provided verified rationale. Never invent alternative solution paths.",
    "Never reveal answers to questions the student hasn't attempted yet.",
  ].join(" ");

  const ctxBlock = [
    question ? `QUESTION: ${question}` : "",
    choices ? `CHOICES: ${choices}` : "",
    studentAnswer ? `STUDENT ANSWERED: ${studentAnswer}` : "",
    correctAnswer ? `CORRECT ANSWER: ${correctAnswer}` : "",
    rationale ? `VERIFIED RATIONALE: ${rationale}` : "",
    diagnosis ? `DISTRACTOR DIAGNOSIS: ${diagnosis}` : "",
    ragBlock,
  ].filter(Boolean).join("\n");

  const ask =
    mode === "walkthrough"
      ? "Walk the student through the solution step by step from the rationale. Short sentences, one idea each. End with: did that click?"
      : mode === "verdict"
      ? "In 2 short sentences: name the specific error the student made (use the diagnosis), then offer to walk through it."
      : (userText ?? "Help the student.");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: `${ctxBlock}\n\n---\n${ask}` },
    ...(Array.isArray(history) ? history.slice(-6) : []),
  ];
  if (mode === "chat" && userText) messages.push({ role: "user", content: userText });

  // Gateway-first, Vertex-failover: during the event the platform gateway's
  // upstream (OpenRouter) ran out of credits — Sage stays up either way.
  const res = await fetch(`https://api.butterbase.ai/v1/${ctx.env.APP_ID}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.GATEWAY_KEY}` },
    body: JSON.stringify({ messages, max_tokens: 500, temperature: 0.4, stream: false }),
  });
  if (res.ok) {
    const data = await res.json();
    return new Response(JSON.stringify({ text: data.choices?.[0]?.message?.content ?? "" }), { headers: { "Content-Type": "application/json" } });
  }
  console.warn(`gateway ${res.status} — failing over to Vertex`);
  if (!ctx.env.VERTEX_KEY) return new Response(JSON.stringify({ error: `gateway ${res.status}, no fallback` }), { status: 502, headers: { "Content-Type": "application/json" } });
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const vres = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${ctx.env.VERTEX_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: sys }] }, generationConfig: { maxOutputTokens: 500, temperature: 0.4 } }),
  });
  if (!vres.ok) return new Response(JSON.stringify({ error: `gateway ${res.status} + vertex ${vres.status}` }), { status: 502, headers: { "Content-Type": "application/json" } });
  const vdata = await vres.json();
  const text = vdata.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  return new Response(JSON.stringify({ text, via: "vertex-failover" }), { headers: { "Content-Type": "application/json" } });
}
