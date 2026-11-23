---
title: Real-time voice AI on ESP32
subtitle: Stream audio from an ESP32-S3 microphone to a voice agent that listens, thinks, calls tools, and talks back through a speaker, using Elato and AssemblyAI.
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

**Model selection:** We use `assemblyai-stt-3-7-realtime-agent` for streaming speech-to-text, `gemma-4-31b` through LLM Gateway for the reply and its tool calls, and the `aai-kyla` voice for text-to-speech. Each character picks its own LLM and voice in the web app, so you can change either without touching the server.

## Overview

In this guide we'll build a voice agent on an ESP32-S3 with an INMP441 MEMS microphone and a MAX98357A amplifier and speaker. Mic audio is sampled as PCM16 at 16 kHz and relayed over a secure WebSocket to a Deno edge server. The server streams it to AssemblyAI speech-to-text, sends each finished turn to LLM Gateway, and streams the reply sentence by sentence to text-to-speech. The reply plays out of the speaker at 24 kHz, and you can interrupt it at any time with a button or touchpad.

Because the server owns the loop, the agent can do more than chat. The model can call tools in the middle of a reply, read the results, and keep talking, and the device can stream sensor data that the agent reacts to on its own. We'll finish with a plant that asks to be watered and shouts when you overdo it.

The voice architecture design comes from [ElatoAI](https://github.com/akdeb/ElatoAI), an MIT-licensed, open-source project that ships the ESP32 firmware, the Deno edge server, and a Next.js webapp with a Supabase DB. The pipeline lives in `server/deno/models/pipeline/`, with one small plug-in per stage, and uses only Deno's built-in `WebSocket` and `fetch` to reach AssemblyAI. Let's dive in!

<div style="display:flex;justify-content:center;margin:1.5rem 0"><iframe src="https://www.youtube.com/embed/0WvnWQE5JS0" title="ESP32 plant agent with AssemblyAI tool calls" style="width:100%;max-width:340px;aspect-ratio:9/16;border:0;border-radius:12px" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>

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
│ MAX98357A    │◀────── │ runs tool calls    │        └──────────────────────┘
│ + speaker    │ Opus   │ sentence-by-       │  wss   ┌──────────────────────┐
└──────────────┘        │ sentence to TTS    │ ─────▶ │ Streaming TTS        │
                        └────────────────────┘ ◀───── │ 24 kHz PCM audio     │
                                                      └──────────────────────┘
```

| Hop | Protocol | Notes |
| --- | --- | --- |
| ESP32 ⇄ edge server | `ws://` in `DEV_MODE`, `wss://` otherwise | Mic audio goes up as PCM16 at 16 kHz. The reply comes back as Opus packets. JSON frames carry control messages such as `INTERRUPT`. |
| Edge server → STT | `wss://streaming.assemblyai.com/v3/ws` | The mic audio is forwarded as is. A `Turn` message with `end_of_turn` marks the end of what you said. |
| Edge server → LLM Gateway | `https://llm-gateway.assemblyai.com/v1/chat/completions` | OpenAI-compatible, with `stream: true` so tokens arrive as they are written, and `tools` so the model can ask the server to run something. |
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

Before you start, you need:

- The hardware above, wired up.
- [PlatformIO](https://platformio.org/) to flash the firmware, and [Deno](https://deno.com/) to run the edge server.
- A Supabase project and the Elato web app running locally. The [ElatoAI quickstart](https://www.elatoai.com/docs/quickstart) covers both.
- An AssemblyAI API key.

### Step 1: Clone the repo

```bash
git clone https://github.com/akdeb/ElatoAI.git assemblyai-esp32
cd assemblyai-esp32
```

From here on, we'll run everything from the root of this repo. For full setup, firmware flashing and frontend quickstart details, see the [quickstart docs](https://www.elatoai.com/docs/quickstart).

### Step 2: Set your environment variables

The edge server holds your API key, so it never touches the device. You can get one from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard). The same key works for speech-to-text, LLM Gateway and text-to-speech.

```bash
cd server/deno
cp .env.example .env
```

Set these in `server/deno/.env`. The server stores conversations in Supabase, so it needs your Supabase project URL and anon key too:

```bash
ASSEMBLYAI_API_KEY=<your-assemblyai-key>
SUPABASE_URL=<your-supabase-url>
SUPABASE_KEY=<your-supabase-anon-key>
```

### Step 3: Run the Deno edge server

The Deno edge server in `server/deno` sits between the ESP32 and AssemblyAI. The pipeline in `models/pipeline/` is split by stage: `stt/assemblyai.ts`, `llm/openai-compatible.ts` and `tts/assemblyai.ts` each talk to one AssemblyAI product, and `runner.ts` is the turn loop that ties them together. When a device connects, the runner opens a speech-to-text session and a text-to-speech session and keeps both open for the whole call. The region and turn-detection settings come from `.env`; the defaults are already the ones we chose above.

The mic audio is already 16 kHz PCM16, which is what speech-to-text takes, so it's forwarded without resampling. The `speech_model` is the one built for voice agents, and `min_turn_silence` and `max_turn_silence` set how long a pause has to be before AssemblyAI ends your turn. The text-to-speech session asks for 24 kHz PCM, which is the rate the server's Opus encoder uses, so it needs no conversion either.

```typescript file="server/deno/models/pipeline/stt/assemblyai.ts" from="        const url = `wss://${HOST}/v3/ws?`" to="        let sock: WebSocket | null = null;"
```

When a `Turn` arrives with `end_of_turn` set, the runner tells the device it can stop listening and starts a reply:

```typescript file="server/deno/models/pipeline/runner.ts" from="        onTurn(text: string) {" to="    // ---- device socket"
```

The reply is where the pipeline gets its speed. We call LLM Gateway with `stream: true`, and cut the streamed text into sentences as it arrives. The first chunk is allowed to end at its first clause, so the speaker starts sooner. Text deltas go to the sentence cutter, and tool-call deltas are collected for later:

```typescript file="server/deno/models/pipeline/runner.ts" from="                for await (const d of cfg.llm.stream" to="                const rest = chunker.flush();"
```

Each finished sentence goes to text-to-speech with a `Generate` followed by a `Flush`, while the model is still writing the rest of the reply:

```typescript file="server/deno/models/pipeline/tts/assemblyai.ts" from="                    say(text) {" to="                    end() {"
```

Text-to-speech renders much faster than real time, so the server paces the audio it sends to the ESP32 to stay a short, fixed distance ahead of the speaker instead of flooding its buffer. Every turn logs two numbers, `end_of_turn->llm_first_token` and `end_of_turn->first_audio`, so you can see where the time goes on your own network.

When you interrupt, we cancel the pipeline from the front. The model request is aborted, text-to-speech gets a `Cancel`, and any audio already on the way is dropped:

```typescript file="server/deno/models/pipeline/runner.ts" from="    const interrupt = " to="    const runTurn"
```

When the call ends, we send `Terminate` on both sessions so you're billed only for the call.

Time to run it. Start the server from `server/deno`:

```bash
deno run -A --env-file=.env main.ts
```

Locally the server speaks plain HTTP on port 8000, so the ESP32 reaches it at `ws://<your-computer-ip>:8000`. There's no TLS on this hop yet. We'll fix that in [Step 5](#step-5-deploy-and-switch-to-wss) when we deploy the server to a remote host.

Last piece: in the web app, create a character and choose **Pipeline**. You get three dropdowns, one per stage. Pick **STT-3.7 Realtime Agent** (`assemblyai-stt-3-7-realtime-agent`) for speech-to-text, an LLM Gateway model for the LLM, and a voice like `aai-kyla`, `aai-peter` or `aai-nancy` for text-to-speech. The picker has a starter set, and any `voice_id` from the [voice catalog](https://www.assemblyai.com/docs/tts/voices) works, including a voice you cloned in the dashboard: set `ASSEMBLYAI_TTS_VOICE` to its id.

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

## Make it agentic: tool calls

So far the agent only talks. Let's let it act. The runner sends a `tools` list with every LLM Gateway request, and a reply can come back as a tool call instead of, or as well as, text. Every character gets `end_session`, so saying goodbye hangs up, and tool packs add their own:

```typescript file="server/deno/models/pipeline/runner.ts" from="    const tools: ToolSpec[]" to="    // ---- history"
```

A reply can take more than one round. When the model asks for tools, the runner runs them, appends the results to the conversation, and calls LLM Gateway again, so the model can read a sensor and then talk about what it found. Anything it said before the tool call has already gone to the speaker, so there's no silence while the tool runs:

```typescript file="server/deno/models/pipeline/runner.ts" from="                const list = [...calls" to="        } catch (err: any) {"
```

Each tool call shows up in the server log with its arguments and result, which makes it easy to see what the model decided.

### Example: a plant that talks back

This is the demo in the video at the top of this page. A soil moisture sensor sits in a plant pot, the ESP32 streams its reading to the server twice a second as a `{"type":"sensor"}` frame on the same WebSocket, and the agent plays the plant. The tool pack in `tools/plant.ts` gives the model two tools:

```typescript file="server/deno/models/pipeline/tools/plant.ts" from="export const PLANT_TOOLS" to="export const PLANT_PROMPT"
```

The plant also speaks without being asked. The server watches the sensor stream, and when the soil gets wetter fast, it adds a `[SENSOR]` message to the conversation and starts a reply, so the plant says thank you the moment you start pouring. If the reading shoots past "soaked", that event interrupts whatever the plant is saying, for the "woah, slow down" moment. When the soil stays dry and nobody has spoken for a while, the plant asks for water again. Turn it on with `PIPELINE_PLANT_MODE=True` in `.env`.

To build your own, copy `tools/plant.ts`: export your tool definitions, answer them in a `runTool`, and raise events from whatever your device sends.

> [!NOTE] AssemblyAI's text-to-speech reads text literally and has no emotion tags, so the plant's prompt asks the model to put feeling into the words themselves: "Ooh!", "Sooo thirsty", "Woah — woah — okay!". Stage directions like `*sighs*` aren't speakable, so the runner removes them before they reach text-to-speech.

---

## Tune the pipeline

Every stage is a setting in `server/deno/.env`, so you can change one without touching the others:

| Setting | Default | What it does |
| --- | --- | --- |
| `ASSEMBLYAI_STT_MODEL` | `assemblyai-stt-3-7-realtime-agent` | The streaming speech-to-text model. |
| `ASSEMBLYAI_LLM_MODEL` | `claude-haiku-4-5-20251001` | The LLM for characters that don't pick one in the web app. Any [LLM Gateway model](https://www.assemblyai.com/docs/llm-gateway/available-models) that supports `stream` and `tools`. Smaller and faster models start speaking sooner. |
| `ASSEMBLYAI_MIN_TURN_SILENCE`, `ASSEMBLYAI_MAX_TURN_SILENCE` | `160`, `400` | Milliseconds of quiet before a turn ends. Lower is snappier. Higher means fewer cut-offs when you pause mid-sentence. |
| `ASSEMBLYAI_REGION` | `us` | `us` or `eu`. Moves all three services together. |
| `ASSEMBLYAI_LLM_REASONING_EFFORT` | unset | Passed to models that support it. Use a low setting for faster first words. |
| `ASSEMBLYAI_TTS_VOICE` | unset | A voice id, such as a cloned voice, that overrides every character's voice. |
| `PIPELINE_PLAYBACK_LEAD_MS` | `800` | How much audio the server keeps ahead of the speaker. |
| `PIPELINE_OPUS_BITRATE` | `48000` | Bitrate of the Opus audio sent to the device. |
| `PIPELINE_PLANT_MODE` | unset | `True` turns on the plant tool pack. |

The LLM and the voice are per-character settings in the web app, not server settings.

## How it works

- **Listening.** Once the device is awake and connected, it streams your mic to the server while it's in the listening state, and AssemblyAI's end-of-turn detection decides when you're done talking, so you don't hold a button to talk. The device stops streaming the mic while the agent is speaking.
- **Overlapping the stages.** The reply doesn't wait for the previous stage to finish. Text-to-speech starts on the first sentence while the model is still writing the second, and both sessions are already open when you start talking.
- **Tools between rounds.** A reply can call tools, wait for their results, and continue, up to three rounds per turn. Sensor events start their own turns, so the agent can speak first.
- **One reply at a time.** Each finished turn gets one reply, and we log both sides of the conversation to Supabase. If an interruption cuts a reply short, we keep what the model had said so far, so it has context on your next turn.
- **Interrupting.** The device doesn't stream your mic while the agent is speaking, so you interrupt with a short tap on the button or touchpad. We cancel the model request and the speech, the device stops playing, and it goes back to listening.
- **Opus on the way back.** Mic audio goes up as PCM16, which is about 32 KB/s. We encode the reply to Opus on the server, so the downstream traffic stays small even on a weak Wi-Fi link and decode it back on the ESP32.

---

## Limitations

After running this design and the framework on hundreds of ESP32 devices globally, here are the limits Akash Deb, founder of Elato, and his team have documented:

- **Cold starts.** Connecting to a freshly started edge server takes about 2 to 3 seconds.
- **Session length.** Edge hosts end a connection when their wall-clock limit is reached. The team has tested up to 17 minutes of uninterrupted voice AI conversation.
- **Interruptions.** For ESP32 boards without echo cancellation, we cannot detect barge-in while the AI agent is speaking. It only stops playing when the server tells it to, or when the user explicitly sends a button/touchpad interrupt signal. If your hardware cancels echo, set `PIPELINE_BARGE_IN=True` and the server will also stop when speech-to-text hears you talking over the agent.
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
- Add tools like timers, smart-home actions or sensor reads. Write a tool pack like `tools/plant.ts`, and the runner already handles the rounds, the results and the follow-up request.
- Swap the model. Pick a different LLM per character in the web app, and compare the logged `first_audio` times to find the best speed and quality trade-off.
- Mix providers. Each stage is a plug-in, so a character can use AssemblyAI speech-to-text with another provider's LLM or voice. Add your own by implementing the small interfaces in `models/pipeline/types.ts`.
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
