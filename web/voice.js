/**
 * Sage voice tutor — Gemini Live over Vertex AI express mode, raw WebSocket.
 * Protocol proven in bot/vertex-live-audio.ts: audio arrives as
 * serverContent.modelTurn.parts[].inlineData (PCM 24kHz), mic goes up as
 * realtimeInput.mediaChunks (PCM 16kHz base64). Barge-in via serverContent.interrupted.
 */
const VOICE_MODEL = "projects/407972401531/locations/global/publishers/google/models/gemini-live-2.5-flash";

let ws = null, micCtx = null, micNode = null, micStream = null;
let playCtx = null, playHead = 0;
let voiceOn = false;

function b64ToF32(b64) {
  const bin = atob(b64);
  const i16 = new Int16Array(new Uint8Array([...bin].map((c) => c.charCodeAt(0))).buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

function playPCM(b64) {
  if (!playCtx) { playCtx = new AudioContext({ sampleRate: 24000 }); playHead = playCtx.currentTime; }
  const f32 = b64ToF32(b64);
  const buf = playCtx.createBuffer(1, f32.length, 24000);
  buf.copyToChannel(f32, 0);
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);
  playHead = Math.max(playHead, playCtx.currentTime + 0.05);
  src.start(playHead);
  playHead += buf.duration;
}

function flushPlayback() { // barge-in: drop queued audio
  if (playCtx) { playCtx.close(); playCtx = null; playHead = 0; }
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true } });
  micCtx = new AudioContext({ sampleRate: 16000 });
  const srcNode = micCtx.createMediaStreamSource(micStream);
  micNode = micCtx.createScriptProcessor(4096, 1, 1);
  micNode.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== 1) return;
    const f32 = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(i16.buffer)));
    ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64 }] } }));
  };
  srcNode.connect(micNode);
  micNode.connect(micCtx.destination);
}

function stopVoiceInternals() {
  try { micNode?.disconnect(); micCtx?.close(); micStream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { ws?.close(); } catch {}
  flushPlayback();
  ws = micCtx = micNode = micStream = null;
}

/** Build the tutoring context from the page's current state. */
function voiceContext() {
  const q = (typeof lastWrong !== "undefined" && lastWrong?.q) || (typeof current !== "undefined" && current) || null;
  if (!q) return "The student has not started a question yet. Greet them briefly.";
  const answered = typeof lastWrong !== "undefined" && lastWrong;
  return [
    `CURRENT QUESTION: ${q.question}`,
    `CHOICES: ${q.choices.map((c) => `${c.label}) ${c.text}`).join(" ")}`,
    answered ? `THE STUDENT ANSWERED: ${lastWrong.label} (wrong). CORRECT: ${q.correct}.` : `The student has not answered yet — NEVER reveal the answer.`,
    `VERIFIED RATIONALE (your only source of truth): ${q.rationale ?? ""}`,
  ].join("\n");
}

async function toggleVoice() {
  const btn = document.getElementById("voicebtn");
  if (voiceOn) { stopVoiceInternals(); voiceOn = false; btn.textContent = "🎤 Talk it through (voice)"; btn.classList.remove("live"); sysmsg("Voice off."); return; }

  btn.textContent = "Connecting…";
  try {
    let key = null;
    try { key = (await (await fetch("/api/voice-config")).json()).key; } catch {}
    if (!key) {
      sysmsg("🎤 Voice runs on the demo machine (the key never ships to the public site). Use the chat tutor here, or visit the demo station for the full voice experience.");
      btn.textContent = "🎤 Voice (demo machine only)";
      return;
    }
    ws = new WebSocket(`wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent?key=${key}`);
    ws.onmessage = async (ev) => {
      const data = JSON.parse(typeof ev.data === "string" ? ev.data : await ev.data.text());
      if (data.setupComplete) {
        await startMic();
        voiceOn = true;
        btn.textContent = "🔴 Voice live — tap to stop";
        btn.classList.add("live");
        sysmsg("Sage is listening — just talk. 📷 sends your scratch work.");
        document.getElementById("photobtn")?.style.setProperty("display", "block");
        // open with a nudge so Sage speaks first
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "I just opened the voice tutor. Briefly check in with me about this question." }] }], turnComplete: true } }));
        return;
      }
      // tool call: the model asks for the question currently on screen
      if (data.toolCall?.functionCalls?.length) {
        ws.send(JSON.stringify({ toolResponse: { functionResponses: data.toolCall.functionCalls.map((fc) => ({
          id: fc.id, name: fc.name, response: { screen: voiceContext() },
        })) } }));
        return;
      }
      const sc = data.serverContent;
      if (sc?.interrupted) { flushPlayback(); return; }
      for (const p of sc?.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) playPCM(p.inlineData.data);
        if (p.text) sagemsg(p.text);
      }
    };
    ws.onopen = () => ws.send(JSON.stringify({
      setup: {
        model: VOICE_MODEL,
        generationConfig: { responseModalities: ["AUDIO"] },
        tools: [{ functionDeclarations: [{
          name: "get_current_question",
          description: "Returns the question CURRENTLY on the student's screen: text, choices, whether they answered, and the verified rationale. Call this whenever the student moves to a new question, asks what's on screen, or before explaining anything — your initial context goes stale as they advance.",
        }] }],
        systemInstruction: { parts: [{ text:
          "You are Sage, a warm, encouraging GMAT/GRE quant voice tutor sitting next to the student. Speak in short, natural sentences — one idea at a time, then pause. Ground every explanation in the verified rationale. Never reveal answers to unanswered questions; guide with questions first, Socratic style.\n" +
          "IMPORTANT: the student advances through questions while you talk. Your context below is only the STARTING state — when they mention a new question or you receive a CONTEXT UPDATE, trust that. Call get_current_question whenever unsure what's on screen.\n\n" + voiceContext() }] },
      },
    }));
    ws.onclose = (ev) => { if (voiceOn) sysmsg(`Voice disconnected${ev.reason ? ": " + ev.reason.slice(0, 60) : ""}.`); stopVoiceInternals(); voiceOn = false; btn.textContent = "🎤 Talk it through (voice)"; btn.classList.remove("live"); };
    ws.onerror = () => sysmsg("Voice connection error.");
  } catch (e) {
    sysmsg("Voice unavailable: " + e.message);
    btn.textContent = "🎤 Talk it through (voice)";
  }
}

/** Called by the quiz whenever the on-screen question changes — silently
 *  refreshes the live session's context (turnComplete:false = no spoken reply). */
function voiceQuestionChanged() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ clientContent: {
    turns: [{ role: "user", parts: [{ text: "CONTEXT UPDATE — the screen changed. Do not respond to this message. New state:\n" + voiceContext() }] }],
    turnComplete: false,
  } }));
}

/** "Show me your work" — send a camera frame of handwritten scratch work. */
async function sendWorkPhoto() {
  if (!ws || ws.readyState !== 1) return sysmsg("Start voice first.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 600)); // autoexposure settle
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    track.stop();
    const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: b64 }] } }));
    ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "That's a photo of my scratch work for this question. Look at it and tell me where my error is." }] }], turnComplete: true } }));
    sysmsg("📷 Work photo sent — Sage is looking…");
  } catch (e) { sysmsg("Camera unavailable: " + e.message); }
}
