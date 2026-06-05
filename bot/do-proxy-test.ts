const TOK = "20949b63f3f15f23e133759d";
const ws = new WebSocket(`wss://sage-tutor.butterbase.dev/_do/voice-proxy/${TOK}?session=${TOK}`);
const t = setTimeout(() => { console.log("TIMEOUT — no setupComplete"); process.exit(1); }, 20000);
ws.onopen = () => {
  console.log("✓ proxy ws open");
  ws.send(JSON.stringify({ setup: { model: "projects/407972401531/locations/global/publishers/google/models/gemini-live-2.5-flash", generationConfig: { responseModalities: ["AUDIO"] } } }));
};
ws.onmessage = async (ev) => {
  const data = JSON.parse(typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text());
  if (data.setupComplete) { console.log("✓ setupComplete THROUGH THE PROXY — public voice works"); clearTimeout(t); ws.close(); process.exit(0); }
  console.log("msg:", JSON.stringify(data).slice(0, 120));
};
ws.onclose = (ev) => console.log("closed", ev.code, ev.reason?.slice(0, 100));
ws.onerror = (e: any) => console.log("error", e?.message ?? "");
