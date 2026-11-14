---
title: Real-time voice AI on ESP32
subtitle: Build a voice agent on a $10 ESP32-S3 with Elato and the AssemblyAI Voice Agent API, or with streaming Speech-to-Text, LLM Gateway, and Text-to-Speech.
---

<!--
EDITING THIS PAGE
Edit this file, then run `node scripts/gen-docs.mjs` and refresh http://localhost:3000.
Do not edit content/realtime-esp32.html. It is generated and gets overwritten.

- ## and ### headings become sections and the right-hand table of contents.
  Anchor ids come from the heading text. Add {#custom-id} to a heading to set one.
- `> [!NOTE] text` makes a callout.
- Code blocks with a file="" attribute are pulled from a checkout of ElatoAI so they can't drift:
    ```cpp file="firmware-arduino/src/Audio.cpp" from="start text" to="end text"
    ```
  The path is relative to the ElatoAI repo root. The generator looks for it at ../../ElatoAI,
  or at the folder in the ELATO_DIR environment variable. The excerpt runs from `from` up to
  (not including) `to`. Leave the block body empty. Code blocks without file="" are shown as written.
- {{pin:I2S_SCK}} becomes "GPIO 1 (`I2S_SCK`)", using the number in firmware-arduino/src/Config.cpp.
- Raw HTML (the video embed and the wiring image) is passed through as is.
-->

## Overview

In this guide we'll learn how to build conversational AI agents with the ESP32-S3 and AssemblyAI. We'll use the ESP32-S3 because it's a powerful, low-cost, low-power microcontroller that can run a voice agent over secure WebSockets with a Deno Edge Server relay between our latest ASR, LLM Gateway, and TTS models.

We'll build our voice agent on an ESP32-S3 with an INMP441 MEMS microphone and a MAX98357A amplifier and speaker. You talk into the mic where PCM16 audio is sampled at 16kHz and relayed via WebSockets to a Deno edge server and the AI speech plays out of the speaker at 24kHz.

We'll use the voice agent architecture design from [ElatoAI](https://github.com/akdeb/ElatoAI), an open-source project for building conversational AI interfaces on ESP32 devices. The full Elato project ships ESP32 firmware, a Deno edge server, a Next.js app with Supabase DB. AssemblyAI handles the speech-to-text, the LLM reply through LLM Gateway, and the text-to-speech. You can also interrupt the agent at any time by pressing a dedicated button or touchpad. The project's AssemblyAI managed Voice Agent API server files are available on GitHub at [ElatoAI](https://github.com/akdeb/ElatoAI). Let's dive in!

<div style="display:flex;justify-content:center;margin:1.5rem 0"><iframe src="https://www.youtube.com/embed/FAm6QM6FgiA" title="AssemblyAI voice agent on ESP32 demo" style="width:100%;max-width:340px;aspect-ratio:9/16;border:0;border-radius:12px" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>

> [!NOTE] We'll set `ASSEMBLYAI_API_KEY` on the edge server only, so the key never touches the device. You can get one from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard). The Voice Agent API also needs an account with Voice Agent API access.

---

## Architecture

```text
  ESP32-S3              Edge server (Deno)     AssemblyAI

┌──────────────┐        ┌───────────────┐       ┌───────────────────┐
│ INMP441 mic  │ PCM    │ ElatoAI       │ wss   │ Voice Agent API   │
│              │──────▶ │ server/deno   │─────▶ │                   │
│              │        │               │◀───── │ speech-to-text    │
│              │        │ API key lives │       │ LLM               │
│              │        │ here, not on  │       │ text-to-speech    │
│ MAX98357A    │◀────── │ the device    │       │ turn-taking       │
│ + speaker    │ Opus   │               │       │                   │
└──────────────┘        └───────────────┘       └───────────────────┘
```

| Hop | Protocol | Notes |
| --- | --- | --- |
| ESP32 ⇄ edge server | `ws://` in `DEV_MODE`, `wss://` otherwise | Mic audio goes up as PCM16 at 16 kHz. The reply comes back as Opus packets. JSON frames carry control messages such as `INTERRUPT`. |
| Edge server → Voice Agent API | `wss://agents.assemblyai.com/v1/ws` | `session.update` configures the agent. 24 kHz PCM in and out. |

---

## Hardware

Here's what we need:

| Part | Purpose |
| --- | --- |
| ESP32-S3 dev board with Wi-Fi | Runs the firmware (`firmware-arduino`). |
| INMP441 I2S microphone | Audio in. |
| MAX98357A I2S amplifier and small speaker | Audio out. |
| Button | Wakes the device and interrupts the agent. |
| RGB LED, common anode, with three resistors (optional) | Shows the device state. |

### Wiring

Let's wire the boards to the ESP32-S3. The pin numbers below are the defaults in `firmware-arduino/src/Config.cpp`, so if you use other pins, change them there.

<figure style="margin:1.5rem 0"><img src="/assets/wiring-diagram.png" alt="Wiring diagram: INMP441 microphone, MAX98357A amplifier with speaker, button and LED connected to an ESP32-S3 board" style="width:100%;height:auto;border-radius:12px" loading="lazy"/><figcaption style="margin-top:.5rem;font-size:.875rem;opacity:.7">Wiring for the ElatoAI firmware. Red is power, black is ground, green is signal.</figcaption></figure>

| Module | Module pin | ESP32-S3 pin | Notes |
| --- | --- | --- | --- |
| INMP441 mic | VDD | 3V3 | 3.3 V only. Don't connect it to 5 V. |
|  | GND | GND |  |
|  | SCK | {{pin:I2S_SCK}} | Bit clock. |
|  | WS | {{pin:I2S_WS}} | Word select. |
|  | SD | {{pin:I2S_SD}} | Audio data from the mic. |
|  | L/R | GND | Selects the left channel, which the firmware reads. Don't leave it floating. |
| MAX98357A amp | VIN | 3V3 | Same rail as the mic. |
|  | GND | GND |  |
|  | BCLK | {{pin:I2S_BCK_OUT}} | Bit clock. |
|  | LRC | {{pin:I2S_WS_OUT}} | Word select. |
|  | DIN | {{pin:I2S_DATA_OUT}} | Audio data to the amp. |
|  | SD | {{pin:I2S_SD_OUT}} | The firmware drives this high to unmute the amp and low to mute it. |
|  | + and − | Speaker | 4 or 8 Ω speaker. |
| Button | One leg | {{pin:BUTTON_PIN}} | The other leg goes to GND. |
| RGB LED | Red leg, through a resistor | {{pin:RED_LED_PIN}} | The common leg goes to 3V3. |
|  | Green leg, through a resistor | {{pin:GREEN_LED_PIN}} |  |
|  | Blue leg, through a resistor | {{pin:BLUE_LED_PIN}} |  |

The mic and the amp use separate I2S ports, so they don't share clock pins. Keep the jumper wires short, and make sure every module shares a ground with the ESP32.

---

## Build the voice agent

### Step 1: Clone the repo

```bash
git clone https://github.com/akdeb/ElatoAI.git
cd ElatoAI
```

From here on, we'll run everything from the root of this repo. For full setup, firmware flashing and frontend quickstart details, see the [ElatoAI quickstart](https://www.elatoai.com/docs/quickstart).

### Step 2: Set your AssemblyAI API key

The edge server holds your API key, so it never touches the device. You can get one from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard). The Voice Agent API needs an account with Voice Agent API access.

```bash
cd server/deno
cp .env.example .env
```

Set the key in `server/deno/.env`:

```bash
ASSEMBLYAI_API_KEY=<your-assemblyai-key>
```

### Step 3: Run the Deno edge server

Next up is the Deno edge server in `server/deno`. It relays audio between the ESP32 and AssemblyAI's [Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) over a single WebSocket. When a device connects, the server opens that WebSocket and sets up the session with one `session.update` event. We pass in the system prompt, the audio format going in, the voice, and the audio format coming out. 

The voice and the output format can't change after this first update. The agent speaks English, Italian, Spanish, German, Portuguese and French.

```typescript file="server/deno/models/assemblyai.ts" from="    upstream.on('open', () => {" to="    upstream.on('message'"
```

Once the session is ready, the AI agent speaks first. We send a `reply.create` event and the model composes the greeting itself. From there AssemblyAI handles turn-taking, so it decides when you're done talking. The agent's voice comes back as `reply.audio` events, which we encode to Opus and send to the ESP32.

```typescript file="server/deno/models/assemblyai.ts" from="                case 'reply.audio':" to="                case 'transcript.user':"
```

When the call ends, we send `session.end` so you aren't billed for the reconnect grace window.

Time to run it. The server stores conversations in Supabase, so add your Supabase anon key to `server/deno/.env` as `SUPABASE_KEY`, then start the server from `server/deno`:

```bash
deno run -A --env-file=.env main.ts
```

Locally the server speaks plain HTTP on port 8000, so the ESP32 reaches it at `ws://<your-computer-ip>:8000`. There's no TLS on this hop yet. We'll fix that in [Step 5](#step-5-deploy-and-switch-to-wss) when we deploy the server to a remote host.

Last piece: in the web app, create a character, pick **AssemblyAI** as its voice provider, and choose a voice like `alba`, `eve` or `george`. 

The server reads the provider every time a device connects, so you can switch a character's provider without restarting the server or reflashing the ESP32.

### Step 4: Talk to it

Once the serial monitor shows the device is connected, the speaker should start playing out the AI agent's voice. Start talking to the agent and you should hear it respond. Depending on your setup, you can press the button or touchpad to interrupt it mid-speech.

### Step 5: Deploy and switch to wss://

So far the ESP32 has been talking to your computer over `ws://` and `http://`, and both are unencrypted. Anyone on the same network can read the audio and the auth token. That's fine on your own Home Wi-Fi while we develop, but not once the traffic crosses the internet.

For a remote server, we'll use `wss://`. It's the same WebSocket protocol inside TLS, so the traffic is encrypted and can't be read or changed on the way.

| | `DEV_MODE` | `PROD_MODE` |
| --- | --- | --- |
| Device connects to | `ws://192.168.1.100:8000` | `wss://your-edge-server.deno.dev` |
| Encryption | None | TLS |
| Who provides TLS | Nobody. The server speaks plain HTTP. | The host, for example Deno Deploy. |
| `ws_server` | Your computer's LAN IP | Your deployment's hostname |
| `ws_port` | `8000` | `443` |
| Certificate check | None | The firmware verifies the server against `CA_cert` |
| Use it for | Development on a network you trust | Everything else |

Let's deploy `server/deno` to Deno Deploy or another Deno-compatible host close to your users, and set `ASSEMBLYAI_API_KEY` and your Supabase settings as environment variables there. Then, in `src/Config.h`, we switch to `PROD_MODE`, and in `src/Config.cpp` we fill in the production block:

```cpp file="firmware-arduino/src/Config.cpp" from="#elif defined(PROD_MODE)" to="#elif defined(ELATO_MODE)"
```

The firmware picks its connection call from the mode:

```cpp file="firmware-arduino/src/Audio.cpp" from="    #ifdef DEV_MODE" to="    #endif"
```

> [!NOTE] TLS only protects us from a man-in-the-middle attack if the device checks the server's certificate. In `PROD_MODE` the firmware calls `beginSslWithCA` with the `CA_cert` you paste into `Config.cpp`, and it refuses any server that can't prove its identity. Paste your host's root CA certificate there. The hops from the edge server to AssemblyAI always use `wss://` and `https://`, even in local development.

---

## Optional: the STT + LLM Gateway + Text-to-Speech pipeline

The Voice Agent API is the quickest way to get going. But if you want to choose each model yourself, say to pin the speech-to-text model, use any LLM Gateway model, or pick a specific text-to-speech voice, we can run the same AssemblyAI products as three separate connections instead.

The architecture stays the same. The device still talks to the same edge server, and a provider is just one file in `server/deno/models/` that the server picks based on the character's provider. To use the pipeline, we add one more provider next to `assemblyai.ts`.

| | Voice Agent API (`assemblyai`) | Pipeline (`assemblyai-pipeline`) |
| --- | --- | --- |
| Connections | One WebSocket | Three: STT socket, LLM Gateway request, TTS socket |
| Models | Managed by AssemblyAI. You choose the voice. | You choose: `universal-3-6-pro`, an LLM Gateway model, a TTS voice |
| Turn-taking | Handled by AssemblyAI | The server reacts to `end_of_turn`, then calls the LLM and TTS |
| Audio | 24 kHz PCM in and out | 16 kHz PCM16 in to STT, 24 kHz PCM16 out of TTS |
| Ending a call | `session.end` | The server terminates the STT and TTS sockets |

> [!NOTE] The pipeline provider isn't part of ElatoAI's AssemblyAI support, so we'll add it ourselves. The full provider file is [on GitHub](https://github.com/akdeb/ElatoAI/blob/cac6dcb39de380c5bd12bb0a4ebe337e687a9fc6/server/deno/models/assemblyai-pipeline.ts), and we'll walk through the parts that matter.

### Add the provider file

Create `server/deno/models/assemblyai-pipeline.ts`. It connects to three AssemblyAI endpoints, and each one authenticates with your API key.

```typescript
const STT_URL = 'wss://streaming.assemblyai.com/v3/ws?' +
    new URLSearchParams({ speech_model: 'universal-3-6-pro', sample_rate: String(MIC_RATE) });
const LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';
const ttsUrl = (voiceId: string) =>
    'wss://tts.us.assemblyai.com/v1/ws?' +
    new URLSearchParams({
        voice_id: voiceId,
        language: 'english',
        sample_rate: String(TTS_RATE),
        encoding: 'pcm_s16le',
    });
```

The STT socket stays open for the whole session. When a final turn arrives, we queue it.

```typescript
    const stt = new WebSocket(STT_URL, { headers: { Authorization: assemblyaiApiKey } });

    stt.on('message', (data: Buffer) => {
        let msg: any;
        try {
            msg = JSON.parse(data.toString('utf-8'));
        } catch {
            return;
        }
        if (msg.type !== 'Turn') return;
        const text = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
        if (!text) return;

        if (msg.end_of_turn) {
            turns.push({ text });
            void drain();
        }
    });
```

Each reply gets a new text-to-speech socket. We send `Generate` and `Flush`, encode the PCM we get back to Opus for the device, and send `Cancel` if you interrupt.

```typescript
    // --- Text-to-speech (one socket per reply) -----------------------------
    function interrupt() {
        if (tts?.readyState === WebSocket.OPEN) tts.send(JSON.stringify({ type: 'Cancel' }));
        speaking = false;
        opus.reset();
        if (createdSent) {
            sendDevice({ type: 'server', msg: 'RESPONSE.COMPLETE' });
            createdSent = false;
        }
    }

    function speak(text: string): Promise<void> {
        return new Promise((resolve) => {
            const sock = new WebSocket(ttsUrl(voiceId), {
                headers: { Authorization: assemblyaiApiKey! },
            });
            tts = sock;
            speaking = true;
            sock.on('open', () => {
                sock.send(JSON.stringify({ type: 'Generate', text }));
                sock.send(JSON.stringify({ type: 'Flush' }));
            });
            sock.on('message', (data: Buffer) => {
                let msg: any;
                try {
                    msg = JSON.parse(data.toString('utf-8'));
                } catch {
                    return;
                }
                if (msg.type === 'Audio' && speaking) {
                    ensureResponseStarted();
                    opus.push(Buffer.from(msg.audio, 'base64')); // PCM16 @ 24 kHz -> Opus
                } else if (
                    msg.type === 'FlushDone' || msg.type === 'Cancelled' || msg.type === 'Error'
                ) {
                    if (msg.type === 'Error') console.error('AssemblyAI TTS error:', msg);
                    sock.send(JSON.stringify({ type: 'Terminate' }));
                }
            });
            sock.on('close', () => {
                if (speaking && createdSent) {
                    // Finished normally (not interrupted).
                    opus.flush(true);
                    sendDevice({ type: 'server', msg: 'RESPONSE.COMPLETE' });
                    createdSent = false;
                }
                speaking = false;
                resolve();
            });
            sock.on('error', () => sock.close());
        });
    }
```

We handle replies one at a time: ask the LLM, then speak the answer.

```typescript
    async function drain() {
        if (working) return;
        working = true;
        try {
            while (turns.length && !closed) {
                const turn = turns.shift()!;
                history.push({ role: 'user', content: turn.text });
                if (!turn.hidden) await addConversation(supabase, 'user', turn.text, user);
                const answer = await think(history);
                history.push({ role: 'assistant', content: answer });
                await addConversation(supabase, 'assistant', answer, user);
                if (!closed) await speak(answer);
            }
        } catch (err) {
            console.error('AssemblyAI pipeline error:', err);
            sendDevice({ type: 'server', msg: 'RESPONSE.ERROR' });
            createdSent = false;
            opus.reset();
        } finally {
            working = false;
        }
    }
```

### Register the provider

In `server/deno/main.ts`, we import the provider and add a case to the provider switch:

```typescript
import { connectToAssemblyAIPipeline } from './models/assemblyai-pipeline.ts';

// in the switch (provider) block, next to 'assemblyai':
case 'assemblyai-pipeline':
    await connectToAssemblyAIPipeline(providerArgs);
    break;
```

In `server/deno/utils.ts`, we add the settings the provider imports. The voice is a text-to-speech voice slug like `aai-kyla`, which is AssemblyAI's default voice (you can browse the rest in the [voice catalog](https://www.assemblyai.com/docs/tts/voices)), and the model is an LLM Gateway model:

```typescript
export const defaultAssemblyAIPipelineVoice = "aai-kyla"; // AssemblyAI's default voice
export const assemblyaiLlmModel = Deno.env.get('ASSEMBLYAI_LLM_MODEL') ?? 'claude-haiku-4-5-20251001';
```

It reuses `ASSEMBLYAI_API_KEY`. To change the LLM, set `ASSEMBLYAI_LLM_MODEL` in `server/deno/.env`.

## How it works

- **Listening.** Once the device is awake and connected, it streams your mic to the server while it's in the listening state, and AssemblyAI's turn detection decides when you're done talking, so you don't hold a button to talk. The device stops streaming the mic while the agent is speaking. 
- **One reply at a time.** Each finished turn gets one reply, and we log both sides of the conversation to Supabase.
- **Interrupting.** The device doesn't stream your mic while the agent is speaking, so you interrupt with a short tap on the button or touchpad. We cancel the current reply, the device stops playing, and it goes back to listening.
- **Opus on the way back.** Mic audio goes up as PCM16, which is about 32 KB/s. We encode the reply to Opus on the server, so the downstream traffic stays small even on a weak Wi-Fi link and decode it back on the ESP32.

---

## Limitations

After running this design and the framework on hundreds of ESP32 devices globally, here are the limits Akash Deb, founder of Elato, and his team have documented:

- **Cold starts.** Connecting to a freshly started edge server takes about 2 to 3 seconds.
- **Session length.** Edge hosts end a connection when their wall-clock limit is reached. Elato has tested up to 17 minutes of uninterrupted conversation.
- **Interruptions.** For ESP32 boards without echo cancelleation, we cannot detect barge-in while the AI agent is speaking. It only stops playing when the server tells it to, or when the user explicitly sends a button/touchpad interrupt signal.

---

## Troubleshooting

Most problems come down to Wi-Fi, wiring or power. Keep the serial monitor open with `pio device monitor`, because it shows how far the device got.

### Wi-Fi never connects

- **Use a 2.4 GHz network.** The ESP32-S3 can't see 5 GHz Wi-Fi. If your router puts both bands under one name and the device won't join, create a separate 2.4 GHz network. On an iPhone hotspot, turn on Maximize Compatibility.
- **Check the credentials.** Wi-Fi names and passwords are case-sensitive. Networks with a login page or a username, like hotel and office Wi-Fi, can be a problem for a device without a screen.
- **Power-cycle the board** after you change Wi-Fi credentials.

### Server never connects

The device joins Wi-Fi, but it never reaches the voice server.

- **`ws://` and `wss://` are mixed up.** `DEV_MODE` connects with `ws://` and expects your local server on port `8000`. Any other mode connects with `wss://` on port `443`. A local server only accepts `ws://`, and a hosted one only accepts `wss://`.
- **The device can't reach your computer.** `ws_server` and `backend_server` must be your computer's LAN IP, not `localhost`. To check, open `http://<your-computer-ip>:8000` from a phone on the same Wi-Fi. If it doesn't load, allow incoming connections for Deno in your firewall, and avoid guest networks, which often stop devices from reaching each other.
- **The device never got a token.** Look for `[Auth] Registration HTTP` in the serial monitor. Anything other than `200` means the device couldn't reach the web app at `backend_server` and `backend_port`.
- **The TLS handshake fails in `PROD_MODE`.** `CA_cert` must be your host's root CA certificate. If it's wrong or empty, the firmware rejects the server.

### No transcripts from the mic

The server connects, but the agent never reacts to anything you say.

- **Recheck the three I2S wires.** SCK, WS and SD must go to the pins in the [wiring table](#wiring). A single wire in the wrong place gives you silence, not an error.
- **Tie L/R to GND.** The firmware reads the left channel, and a floating L/R pin gives silence or noise.
- **Power the mic from 3V3**, and check that its ground reaches the ESP32.
- **Shorten the wires.** Long or loose jumper wires corrupt the I2S clock, so reseat them or solder the connections.

### No sound from the speaker

You can see the agent's reply in the web app, but you hear nothing, or only static.

- **Recheck BCLK, LRC and DIN.** Swapping BCLK and LRC is the most common mistake.
- **Wire the amp's SD pin to its GPIO.** The firmware mutes the amp by driving SD low between replies, so if SD isn't connected to the pin in the wiring table, the amp can stay muted.
- **Test the speaker on its own.** Get a small internet-radio sketch playing through the MAX98357A. If the radio plays, your wiring and I2S pins are fine, and the problem is in the audio stream. If it doesn't, recheck the pins in `Config.cpp`.

### Board resets or audio crackles

The board reboots when Wi-Fi connects or when the agent starts speaking, and the serial monitor may print `Brownout detector was triggered`. That's a USB brownout. Wi-Fi and the amplifier draw current in bursts, and a weak USB port or a thin cable can't keep the voltage up.

- **Change the cable and the port.** Use a short, good-quality USB cable plugged straight into your computer, or a 5 V supply rated for 1 A or more. Avoid unpowered hubs.
- **Add a capacitor.** 470 µF or more across the amp's VIN and GND soaks up the current spikes.
- **Lower the load.** An 8 Ω speaker draws less current than a 4 Ω one.

---

## Customize and extend

Here are a few ways to make it your own:

- Change the persona and the voice in the web app.
- Add tool calls like timers or smart-home actions. We declare them in `session.update`, run them in the server, and send the results back.
- Deploy the server near your users. End-to-end latency comes from Wi-Fi, network distance, model time and playback, so measure it on your own hardware and region.

---

## Next steps

- [ElatoAI on GitHub](https://github.com/akdeb/ElatoAI) — The full open-source project: firmware, Deno edge server, and web app
- [ElatoAI Quickstart](https://www.elatoai.com/docs/quickstart) — Full setup details for Supabase, the web app and the firmware
- [Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) — Learn more about the managed Voice Agent API
- [Best practices for building voice agents](https://www.assemblyai.com/docs/voice-agents/best-practices) — Tips for getting the most out of AssemblyAI in a voice agent
- [Text-to-Speech quickstart](https://www.assemblyai.com/docs/tts/getting-started/quickstart) — Turn text into speech with one SDK call or HTTP request
- [Text-to-Speech voices](https://www.assemblyai.com/docs/tts/voices) — Browse the voice catalog and learn how to name a voice with `voice_id`
