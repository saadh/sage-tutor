import { GoogleGenAI, Modality } from "@google/genai";
const ai = new GoogleGenAI({ vertexai: true, apiKey: process.env.key ?? process.env.GEMINI_API_KEY! });
const MODEL = "projects/407972401531/locations/global/publishers/google/models/gemini-live-2.5-flash";
let audioBytes = 0, done = false;
const session = await ai.live.connect({
  model: MODEL,
  config: { responseModalities: [Modality.AUDIO], systemInstruction: "You are Sage, a warm quant tutor. Be brief." },
  callbacks: {
    onmessage: (msg: any) => {
      if (msg.data) audioBytes += atob(msg.data).length;
      const parts = msg.serverContent?.modelTurn?.parts ?? [];
      for (const p of parts) {
        if (p.inlineData?.data) { audioBytes += atob(p.inlineData.data).length; }
        if (p.text) console.log("text part:", p.text.slice(0, 60));
      }
      const keys = Object.keys(msg).filter(k => msg[k] !== undefined);
      console.log("msg keys:", keys.join(","), parts.length ? `parts: ${parts.map((p: any) => Object.keys(p)).join("|")}` : "");
      if (msg.serverContent?.turnComplete) done = true;
    },
    onerror: (e: any) => console.log("err:", e?.message),
    onclose: (e: any) => console.log("closed:", e?.reason?.slice(0, 80) ?? ""),
  },
});
session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Say hello to the student in one short sentence." }] }], turnComplete: true });
const t0 = Date.now();
while (!done && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 200));
console.log(`\naudio bytes: ${audioBytes} · turnComplete: ${done}`);
session.close();
process.exit(audioBytes > 0 ? 0 : 1);
