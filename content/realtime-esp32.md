---
title: Real-time voice AI on ESP32
subtitle: Stream audio from an ESP32-S3 microphone through AssemblyAI streaming speech-to-text, LLM Gateway, and text-to-speech to build a voice agent that listens, thinks, and talks back through a speaker, using Elato.
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

**Products used:** [Real-time STT](https://www.assemblyai.com/docs/streaming) + [LLM Gateway](https://www.assemblyai.com/docs/llm-gateway) + [Text-to-Speech](https://www.assemblyai.com/docs/tts)

**Model selection:** We use `assemblyai-stt-3-7-realtime-agent` for streaming speech-to-text, `claude-haiku-4-5-20251001` through LLM Gateway for the reply, and the `aai-kyla` voice for text-to-speech. Each one is a setting you can change.

> [!NOTE] AssemblyAI is retiring the managed Voice Agent API in favor of these three products, so this guide builds the agent from them directly. If you're coming from the Voice Agent API, see [Migrating from the Voice Agent API](#migrating-from-the-voice-agent-api).

## Overview

In this guide we'll build a voice agent on an ESP32-S3 with an INMP441 MEMS microphone and a MAX98357A amplifier and speaker. Mic audio is sampled as PCM16 at 16 kHz and relayed over a secure WebSocket to a Deno edge server. The server streams it to AssemblyAI speech-to-text, sends each finished turn to LLM Gateway, and streams the reply sentence by sentence to text-to-speech. The reply plays out of the speaker at 24 kHz, and you can interrupt it at any time with a button or touchpad.

The voice architecture design comes from [ElatoAI](https://github.com/akdeb/ElatoAI), an MIT-licensed, open-source project that ships the ESP32 firmware, the Deno edge server, and a Next.js webapp with a Supabase DB. The AssemblyAI pipeline provider, `server/deno/models/assemblyai-pipeline.ts`, is live in the same repo and uses only Deno's built-in `WebSocket` and `fetch` to reach AssemblyAI. Let's dive in!

<div style="display:flex;justify-content:center;margin:1.5rem 0"><iframe src="https://www.youtube.com/embed/FAm6QM6FgiA" title="AssemblyAI voice agent on ESP32 demo" style="width:100%;max-width:340px;aspect-ratio:9/16;border:0;border-radius:12px" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>

> [!NOTE] We'll set `ASSEMBLYAI_API_KEY` on the edge server only, so the key never touches the device. You can get one from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard).

---

## Architecture

```text
  ESP32-S3              Edge server (Deno)                   AssemblyAI

┌──────────────┐        ┌────────────────────┐  wss   ┌──────────────────────┐
│ INMP441 mic  │ PCM16  │ ElatoAI            │ ─────▶ │ Streaming STT        │
│              │ 16 kHz │ server/deno        │ ◀───── │ end-of-turn          │
│              │──────▶ │                    │        └──────────────────────┘
│              │        │ API key lives here │  https ┌──────────────────────┐
│              │        │ and not on the     │ ─────▶ │ LLM Gateway          │
│              │        │ device             │ ◀───── │ streamed reply       │
│ MAX98357A    │◀────── │                    │        └──────────────────────┘
│ + speaker    │ Opus   │ sentence-by-       │  wss   ┌──────────────────────┐
└──────────────┘        │ sentence to TTS    │ ─────▶ │ Streaming TTS        │
                        └────────────────────┘ ◀───── │ 24 kHz PCM audio     │
                                                      └──────────────────────┘
```

| Hop | Protocol | Notes |
| --- | --- | --- |
| ESP32 ⇄ edge server | `ws://` in `DEV_MODE`, `wss://` otherwise | Mic audio goes up as PCM16 at 16 kHz. The reply comes back as Opus packets. JSON frames carry control messages such as `INTERRUPT`. |
| Edge server → STT | `wss://streaming.assemblyai.com/v3/ws` | The mic audio is forwarded as is. A `Turn` message with `end_of_turn` marks the end of what you said. |
| Edge server → LLM Gateway | `https://llm-gateway.assemblyai.com/v1/chat/completions` | OpenAI-compatible, with `stream: true` so tokens arrive as they are written. |
| Edge server → TTS | `wss://tts.us.assemblyai.com/v1/ws` | `Generate` sends text, `Flush` ends a sentence, `Cancel` handles barge-in. 24 kHz PCM comes back. |

Both WebSockets stay open for the whole call, so no turn pays for a new handshake.

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

<figure style="margin:1.5rem 0"><img src="/assets/wiring-diagram.png" alt="Wiring diagram: INMP441 microphone, MAX98357A amplifier with speaker, button and LED connected to an ESP32-S3 board" style="width:100%;height:auto;border-radius:12px" loading="lazy"/><figcaption style="margin-top:.5rem;font-size:.875rem;opacity:.7">Wiring for the ElatoAI firmware with a starter conversational AI board. Red is power, black is ground, green is signal.</figcaption></figure>

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
git clone https://github.com/akdeb/ElatoAI.git assemblyai-esp32
cd assemblyai-esp32
```

From here on, we'll run everything from the root of this repo. For full setup, firmware flashing and frontend quickstart details, see the [quickstart docs](https://www.elatoai.com/docs/quickstart).

### Step 2: Set your AssemblyAI API key

The edge server holds your API key, so it never touches the device. You can get one from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard). The same key works for speech-to-text, LLM Gateway and text-to-speech.

```bash
cd server/deno
cp .env.example .env
```

Set the key in `server/deno/.env`:

```bash
ASSEMBLYAI_API_KEY=<your-assemblyai-key>
```

### Step 3: Run the Deno edge server

The Deno edge server in `server/deno` sits between the ESP32 and AssemblyAI. When a device connects, `models/assemblyai-pipeline.ts` opens a speech-to-text session and a text-to-speech session and keeps both open for the whole call. The model, region and turn-detection settings come from `.env`; the defaults are already the ones we chose above.

The mic audio is already 16 kHz PCM16, which is what speech-to-text takes, so it's forwarded without resampling. The `speech_model` is the one built for voice agents, and `min_turn_silence` and `max_turn_silence` set how long a pause has to be before AssemblyAI ends your turn. The text-to-speech session asks for 24 kHz PCM, which is the rate the server's Opus encoder uses, so it needs no conversion either.

```typescript file="server/deno/models/assemblyai-pipeline.ts" from="    const sttUrl" to="    const onTurn"
```

When a `Turn` arrives with `end_of_turn` set, the server tells the device it can stop listening and starts a reply:

```typescript file="server/deno/models/assemblyai-pipeline.ts" from="    const onTurn" to="    const openStt"
```

The reply is where the pipeline gets its speed. We call LLM Gateway with `stream: true`, and cut the streamed text into sentences as it arrives. The first chunk is allowed to end at its first clause, so the speaker starts sooner. Each chunk goes to text-to-speech with a `Generate` followed by a `Flush`, while the model is still writing the rest of the reply:

```typescript file="server/deno/models/assemblyai-pipeline.ts" from="        const speak = (text: string) => {" to="        const toolCalls"
```

```typescript file="server/deno/models/assemblyai-pipeline.ts" from="                    if (content) {" to="                    for (const tc"
```

Text-to-speech renders much faster than real time, so the server paces the audio it sends to the ESP32 to stay a short, fixed distance ahead of the speaker instead of flooding its buffer. Every turn logs two numbers, `end_of_turn->llm_first_token` and `end_of_turn->first_audio`, so you can see where the time goes on your own network.

When you interrupt, we cancel the pipeline from the front. The model request is aborted, text-to-speech gets a `Cancel`, and any audio already on the way is dropped:

```typescript file="server/deno/models/assemblyai-pipeline.ts" from="    const interrupt = " to="    const runTurn"
```

When the call ends, we send `Terminate` on both sessions so you're billed only for the call.

Time to run it. The server stores conversations in Supabase, so add your Supabase anon key to `server/deno/.env` as `SUPABASE_KEY`, then start the server from `server/deno`:

```bash
deno run -A --env-file=.env main.ts
```

Locally the server speaks plain HTTP on port 8000, so the ESP32 reaches it at `ws://<your-computer-ip>:8000`. There's no TLS on this hop yet. We'll fix that in [Step 5](#step-5-deploy-and-switch-to-wss) when we deploy the server to a remote host.

Last piece: in the web app, create a character, pick **AssemblyAI** as its voice provider, and choose a voice like `aai-kyla`, `aai-peter` or `aai-nancy`. The picker has a starter set, and any `voice_id` from the [voice catalog](https://www.assemblyai.com/docs/tts/voices) works.

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

Let's deploy `server/deno` to Deno Deploy or another Deno-compatible host close to your users, and set `ASSEMBLYAI_API_KEY` and your Supabase settings as environment variables there. Pick the host nearest your users, and set `ASSEMBLYAI_REGION` to `us` or `eu` so speech-to-text, LLM Gateway and text-to-speech all run in the same data zone. Then, in `src/Config.h`, we switch to `PROD_MODE`, and in `src/Config.cpp` we fill in the production block:

```cpp file="firmware-arduino/src/Config.cpp" from="#elif defined(PROD_MODE)" to="#elif defined(ELATO_MODE)"
```

The firmware picks its connection call from the mode:

```cpp file="firmware-arduino/src/Audio.cpp" from="    #ifdef DEV_MODE" to="    #endif"
```

> [!NOTE] TLS only protects us from a man-in-the-middle attack if the device checks the server's certificate. In `PROD_MODE` the firmware calls `beginSslWithCA` with the `CA_cert` you paste into `Config.cpp`, and it refuses any server that can't prove its identity. Paste your host's root CA certificate there. The hops from the edge server to AssemblyAI always use `wss://` and `https://`, even in local development.

---

## Tune the pipeline

Every stage is a setting in `server/deno/.env`, so you can change one without touching the others:

| Setting | Default | What it does |
| --- | --- | --- |
| `ASSEMBLYAI_STT_MODEL` | `assemblyai-stt-3-7-realtime-agent` | The streaming speech-to-text model. |
| `ASSEMBLYAI_LLM_MODEL` | `claude-haiku-4-5-20251001` | Any [LLM Gateway model](https://www.assemblyai.com/docs/llm-gateway/available-models) that supports `stream`. Smaller and faster models start speaking sooner. |
| `ASSEMBLYAI_MIN_TURN_SILENCE`, `ASSEMBLYAI_MAX_TURN_SILENCE` | `160`, `400` | Milliseconds of quiet before a turn ends. Lower is snappier. Higher means fewer cut-offs when you pause mid-sentence. |
| `ASSEMBLYAI_REGION` | `us` | `us` or `eu`. Moves all three services together. |
| `ASSEMBLYAI_LLM_REASONING_EFFORT` | unset | Passed to models that support it. Use a low setting for faster first words. |
| `ASSEMBLYAI_PLAYBACK_LEAD_MS` | `800` | How much audio the server keeps ahead of the speaker. |

The voice is a per-character setting in the web app, not a server setting.

## Migrating from the Voice Agent API

AssemblyAI is sunsetting the managed Voice Agent API, which Elato supported through the `assemblyai` provider and `models/assemblyai.ts`. The old provider still works until the API is shut down, but it's marked deprecated in the web app. To move over:

- **Allow the new provider.** Run the migration `supabase/migrations/20261121000000_add_assemblyai_pipeline_provider.sql`, which allows the new `assemblyai-pipeline` provider value.
- **Update your characters.** Edit each character that uses the old provider, pick **AssemblyAI** and choose a text-to-speech voice. The old voice names, like `alba` and `eve`, aren't text-to-speech voices.
- **Keep the firmware.** You don't need to reflash the ESP32. The device protocol is the same.

Two things change. You now choose the speech-to-text, LLM and text-to-speech models yourself instead of AssemblyAI choosing for you, and turn-taking comes from speech-to-text end-of-turn detection instead of the Voice Agent API's own.

## How it works

- **Listening.** Once the device is awake and connected, it streams your mic to the server while it's in the listening state, and AssemblyAI's end-of-turn detection decides when you're done talking, so you don't hold a button to talk. The device stops streaming the mic while the agent is speaking.
- **Overlapping the stages.** The reply doesn't wait for the previous stage to finish. Text-to-speech starts on the first sentence while the model is still writing the second, and both sessions are already open when you start talking.
- **One reply at a time.** Each finished turn gets one reply, and we log both sides of the conversation to Supabase. If an interruption cuts a reply short, we keep what the model had said so far, so it has context on your next turn.
- **Interrupting.** The device doesn't stream your mic while the agent is speaking, so you interrupt with a short tap on the button or touchpad. We cancel the model request and the speech, the device stops playing, and it goes back to listening.
- **Opus on the way back.** Mic audio goes up as PCM16, which is about 32 KB/s. We encode the reply to Opus on the server, so the downstream traffic stays small even on a weak Wi-Fi link and decode it back on the ESP32.

---

## Limitations

After running this design and the framework on hundreds of ESP32 devices globally, here are the limits Akash Deb, founder of Elato, and his team have documented:

- **Cold starts.** Connecting to a freshly started edge server takes about 2 to 3 seconds.
- **Session length.** Edge hosts end a connection when their wall-clock limit is reached. The team has tested up to 17 minutes of uninterrupted voice AI conversation.
- **Interruptions.** For ESP32 boards without echo cancellation, we cannot detect barge-in while the AI agent is speaking. It only stops playing when the server tells it to, or when the user explicitly sends a button/touchpad interrupt signal. If your hardware cancels echo, set `ASSEMBLYAI_BARGE_IN=True` and the server will also stop when speech-to-text hears you talking over the agent.
- **Cost while connected.** The speech-to-text session stays open for the whole call so that no turn waits on a handshake, and streaming speech-to-text is billed by connection time, so a call is billed for its full length.

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
- Add tool calls like timers or smart-home actions. The model request already declares an `end_session` tool, so add yours to the `TOOLS` list in `assemblyai-pipeline.ts`, run them in the server when the stream reports a tool call, and send the result back in a follow-up request.
- Swap the model. Set `ASSEMBLYAI_LLM_MODEL` to any streaming LLM Gateway model, and compare the logged `first_audio` times to find the best speed and quality trade-off.
- Deploy the server near your users. End-to-end latency comes from Wi-Fi, network distance, model time and playback, so measure it on your own hardware and region.

---

## Next steps

- [ElatoAI on GitHub](https://github.com/akdeb/ElatoAI) — The full open-source project: firmware, Deno edge server, and web app
- [ElatoAI Quickstart](https://www.elatoai.com/docs/quickstart) — Full setup details for Supabase, the web app and the firmware
- [Streaming speech-to-text](https://www.assemblyai.com/docs/streaming) — Turn detection, models and connection parameters
- [LLM Gateway](https://www.assemblyai.com/docs/llm-gateway) — One API for Claude, GPT, Gemini and more, with streaming
- [Optimizing text-to-speech latency](https://www.assemblyai.com/docs/tts/getting-started/optimizing-accuracy-and-latency) — Session, text and format habits for a faster first audio
- [Text-to-Speech quickstart](https://www.assemblyai.com/docs/tts/getting-started/quickstart) — Turn text into speech with one SDK call or HTTP request
- [Text-to-Speech voices](https://www.assemblyai.com/docs/tts/voices) — Browse the voice catalog and learn how to name a voice with `voice_id`
