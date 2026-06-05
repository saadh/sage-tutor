/** Raw WS probe: find the model resource format Vertex express Live accepts. */
const KEY = process.env.key ?? process.env.GEMINI_API_KEY!;
const VARIANTS = [
  "projects/407972401531/locations/global/publishers/google/models/gemini-live-2.5-flash",
  "projects/407972401531/locations/us-central1/publishers/google/models/gemini-live-2.5-flash",
  "projects/407972401531/locations/us-central1/publishers/google/models/gemini-2.0-flash-live-preview-04-09",
];
for (const model of VARIANTS) {
  const result = await new Promise<string>((resolve) => {
    const ws = new WebSocket(
      `wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent?key=${KEY}`,
    );
    const t = setTimeout(() => { ws.close(); resolve("timeout"); }, 12000);
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model, generationConfig: { responseModalities: ["AUDIO"] } } }));
    ws.onmessage = async (ev) => {
      const data = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text?.() ?? String(ev.data);
      clearTimeout(t); ws.close(); resolve("MESSAGE: " + String(data).slice(0, 120));
    };
    ws.onclose = (ev) => { clearTimeout(t); resolve(`closed ${ev.code}: ${ev.reason?.slice(0, 110)}`); };
    ws.onerror = () => {};
  });
  console.log(`${model}\n  → ${result}\n`);
}
