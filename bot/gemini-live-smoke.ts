/** Voice gate part 1 (headless): prove Gemini Live connects, accepts a
 *  function declaration, takes text input, and streams AUDIO back. */
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { apiVersion: "v1alpha" } });

const MODELS = [
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.5-flash-preview-native-audio-dialog",
  "gemini-live-2.5-flash-preview",
];

for (const model of MODELS) {
  try {
    console.log(`\n— trying ${model}`);
    let audioBytes = 0, sawToolCall = false, done = false;
    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: "You are Sage, a warm quant tutor. Be brief.",
        tools: [{ functionDeclarations: [{ name: "get_current_question", description: "Returns the student's current quiz question and context." }] }],
      },
      callbacks: {
        onopen: () => console.log("  ✓ connected"),
        onmessage: (msg: any) => {
          if (msg.data) audioBytes += atob(msg.data).length;
          if (msg.toolCall) { sawToolCall = true;
            session.sendToolResponse({ functionResponses: msg.toolCall.functionCalls.map((fc: any) => ({ id: fc.id, name: fc.name, response: { question: "If 3x+2=11, what is x? Choices: A)2 B)3 C)4. Student answered A (wrong), correct is B." } })) });
          }
          if (msg.serverContent?.turnComplete) done = true;
        },
        onerror: (e: any) => console.log("  ✗ error:", e?.message ?? e),
        onclose: (e: any) => console.log("  closed:", e?.reason ?? e?.code ?? ""),
      },
    });
    session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Call get_current_question, then explain my mistake in one sentence." }] }], turnComplete: true });
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 25_000) await new Promise((r) => setTimeout(r, 250));
    console.log(`  audio bytes: ${audioBytes} · toolCall: ${sawToolCall} · turnComplete: ${done}`);
    session.close();
    if (audioBytes > 0) { console.log(`\nGATE PART 1 PASS with model: ${model}`); process.exit(0); }
  } catch (e: any) {
    console.log("  ✗ connect failed:", (e?.message ?? String(e)).slice(0, 150));
  }
}
console.log("\nGATE PART 1 FAIL — no model produced audio");
process.exit(1);
