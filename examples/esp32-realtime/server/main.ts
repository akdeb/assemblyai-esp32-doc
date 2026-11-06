// examples/esp32-realtime/server/main.ts
//
// Edge relay between an ESP32 and AssemblyAI.
//
//   ESP32 mic --PCM16 16 kHz--> relay --> AssemblyAI Streaming STT (Universal-3 Pro)
//                                  |--> LLM Gateway (chat completions)
//   ESP32 spk <--PCM16 24 kHz-- relay <-- AssemblyAI TTS (WebSocket)
//
// The AssemblyAI API key lives here, never on the device.
//
// Run:  ASSEMBLYAI_API_KEY=... DEVICE_TOKEN=... deno run -A main.ts

const API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const DEVICE_TOKEN = Deno.env.get("DEVICE_TOKEN") ?? "";
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "claude-haiku-4-5-20251001";
const VOICE_ID = Deno.env.get("TTS_VOICE_ID") ?? "49c443a4-8a1d-5f7e-b70b-98bdbd9823c3";
const SYSTEM_PROMPT =
  Deno.env.get("SYSTEM_PROMPT") ??
  "You are a friendly voice assistant living inside a tiny ESP32 device. " +
    "Answer in one or two short spoken sentences. No markdown, no lists.";

const MIC_RATE = 16000; // ESP32 -> relay
const SPK_RATE = 24000; // relay -> ESP32

const STT_URL =
  "wss://streaming.assemblyai.com/v3/ws?" +
  new URLSearchParams({ speech_model: "universal-3-6-pro", sample_rate: String(MIC_RATE) });

const TTS_URL =
  "wss://tts.us.assemblyai.com/v1/ws?" +
  new URLSearchParams({
    voice_id: VOICE_ID,
    language: "english",
    sample_rate: String(SPK_RATE),
    encoding: "pcm_s16le",
  });

const LLM_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";

// Deno's WebSocket constructor accepts a `headers` option (not in the DOM typings).
// deno-lint-ignore no-explicit-any
const AuthWebSocket = WebSocket as any;
const authedSocket = (url: string): WebSocket =>
  new AuthWebSocket(url, { headers: { Authorization: API_KEY } });

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function think(messages: Msg[]): Promise<string> {
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { Authorization: API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 200 }),
  });
  if (!res.ok) throw new Error(`LLM Gateway ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices[0].message.content.trim();
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function handleDevice(device: WebSocket) {
  const history: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const turns: string[] = [];
  let speaking = false;
  let working = false;

  const send = (obj: unknown) =>
    device.readyState === WebSocket.OPEN && device.send(JSON.stringify(obj));

  // --- Speech-to-text (always listening) ---------------------------------
  const stt = authedSocket(STT_URL);
  stt.binaryType = "arraybuffer";
  stt.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.type !== "Turn") return;
    if (speaking && msg.transcript?.trim()) interrupt(); // barge-in
    if (msg.end_of_turn && msg.transcript?.trim()) {
      send({ type: "transcript", role: "user", text: msg.transcript });
      turns.push(msg.transcript);
      void drain();
    }
  };

  // --- Text-to-speech (opened per reply) ---------------------------------
  let tts: WebSocket | null = null;

  function interrupt() {
    if (tts?.readyState === WebSocket.OPEN) tts.send(JSON.stringify({ type: "Cancel" }));
    speaking = false;
    send({ type: "interrupt" }); // tell the device to flush its playback buffer
    send({ type: "state", state: "listening" });
  }

  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      tts = authedSocket(TTS_URL);
      const sock = tts;
      speaking = true;
      send({ type: "state", state: "speaking" });
      sock.onopen = () => {
        sock.send(JSON.stringify({ type: "Generate", text }));
        sock.send(JSON.stringify({ type: "Flush" }));
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "Audio" && speaking) {
          device.send(decodeBase64(msg.audio)); // raw PCM16 @ 24 kHz
        } else if (msg.type === "FlushDone" || msg.type === "Cancelled" || msg.type === "Error") {
          sock.send(JSON.stringify({ type: "Terminate" }));
        }
      };
      sock.onclose = () => {
        speaking = false;
        resolve();
      };
      sock.onerror = () => sock.close();
    });
  }

  // --- Turn loop: one reply at a time ------------------------------------
  async function drain() {
    if (working) return;
    working = true;
    try {
      while (turns.length) {
        history.push({ role: "user", content: turns.shift()! });
        send({ type: "state", state: "thinking" });
        const answer = await think(history);
        history.push({ role: "assistant", content: answer });
        send({ type: "transcript", role: "assistant", text: answer });
        await speak(answer);
        send({ type: "state", state: "listening" });
      }
    } catch (err) {
      console.error(err);
      send({ type: "error", message: String(err) });
    } finally {
      working = false;
    }
  }

  // --- Device -> relay ----------------------------------------------------
  device.binaryType = "arraybuffer";
  device.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      if (JSON.parse(ev.data).type === "interrupt") interrupt(); // button press
      return;
    }
    if (stt.readyState === WebSocket.OPEN) stt.send(ev.data); // mic PCM16 frames
  };
  device.onclose = () => {
    if (stt.readyState === WebSocket.OPEN) stt.send(JSON.stringify({ type: "Terminate" }));
    tts?.close();
  };
  send({ type: "state", state: "listening" });
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/health") return new Response("ok");
  if (req.headers.get("upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
  if (!DEVICE_TOKEN || url.searchParams.get("token") !== DEVICE_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  handleDevice(socket);
  return response;
});
