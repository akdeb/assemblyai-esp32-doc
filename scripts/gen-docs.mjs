// Generates content/*.html from the saved copy of the real AssemblyAI docs page
// (reference/end-to-end-examples.html) so markup, classes and CSS match exactly.
// Run: node scripts/gen-docs.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { codeToHtml } from "shiki";

const ref = readFileSync("reference/end-to-end-examples.html", "utf8");
const stream = readFileSync("reference/streaming-quickstart.html", "utf8");
const read = (p) => readFileSync(`examples/esp32-realtime/${p}`, "utf8");

const ESP32_PATH = "/docs/getting-started/end-to-end-examples/realtime-esp32";
const E2E_PATH = "/docs/getting-started/end-to-end-examples";
const ELATO = "https://github.com/akdeb/ElatoAI";
const PAGE_TITLE = "[WIP] Realtime speech on ESP32";

// ---------- template pieces lifted from the real pages ----------
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// heading template (with the anchor-link svg)
const h2Tpl = ref.match(/<h2 class="flex whitespace-pre-wrap group font-semibold" id="overview"[\s\S]*?<\/h2>/)[0];
const h3Tpl = stream.match(/<h3 class="flex whitespace-pre-wrap group font-semibold" id="step-1-install-the-sdk"[\s\S]*?<\/h3>/)[0];
let hCount = 0;
const heading = (tag, id, text) => {
  const tpl = tag === "h2" ? h2Tpl : h3Tpl;
  const old = tag === "h2" ? "overview" : "step-1-install-the-sdk";
  const oldText = tag === "h2" ? "Overview" : "Step 1: Install the SDK";
  const uid = `_R_${(++hCount).toString(36)}hkd74t9_`;
  return tpl
    .replaceAll(`#${old}`, `#${id}`).replace(`id="${old}"`, `id="${id}"`)
    .replace(/aria-labelledby="[^"]+"/, `aria-labelledby="${uid}"`)
    .replace(/<span id="[^"]+"/, `<span id="${uid}"`)
    .replace(`Navigate to header: ${oldText}`, `Navigate to header: ${text}`)
    .replace(new RegExp(`>${oldText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span></${tag}>`), `>${esc(text)}</span></${tag}>`);
};

const calloutTpl = ref.match(/<div role="note"[\s\S]*?data-component-part="callout-content">[\s\S]*?<\/span><\/div><\/div>/)[0];
const callout = (inner) =>
  calloutTpl.replace(/<span data-as="p">[\s\S]*<\/span>(<\/div><\/div>)$/, `<span data-as="p">${inner}</span>$1`);

const tableTpl = ref.match(/<div role="presentation"[^>]*data-table-wrapper="true"[\s\S]*?<table class="[^"]*">/)[0];
const table = (head, rows) =>
  `${tableTpl}<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div></div></div></div>`;

const p = (html) => `<span data-as="p">${html}</span>`;
const a = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer" class="link">${text}</a>`;
const ul = (items) => `<ul>\n${items.map((i) => `<li>\n${i.startsWith("<div") ? i : p(i)}\n</li>`).join("\n")}\n</ul>`;

// code block template from the real streaming quickstart
const cbStart = stream.indexOf('<div class="code-block mt-5 mb-8');
const cbPreAt = stream.indexOf('<div class="font-mono whitespace-pre leading-6">', cbStart);
const cbEnd = stream.indexOf("</code></pre></div>", cbPreAt) + "</code></pre></div>".length;
const cbHead = stream.slice(cbStart, cbPreAt);
const cbTail = stream.slice(cbEnd, stream.indexOf('<div class="code-block-fade-overlay', cbEnd));
const cbFade = stream.slice(stream.indexOf('<div class="code-block-fade-overlay', cbEnd)).match(/^<div class="code-block-fade-overlay[^>]*><\/div>/)[0];
const cbClose = "</div>";

async function code(src, lang) {
  const src2 = src.replace(/\n$/, "");
  let html = await codeToHtml(src2, {
    lang,
    themes: { light: "github-light-default", dark: "dark-plus" },
    defaultColor: "light",
    cssVariablePrefix: "--shiki-",
  });
  const inner = html.match(/<code>([\s\S]*)<\/code>/)[1];
  const lines = inner.split("\n").length;
  const shell = `<div class="font-mono whitespace-pre leading-6"><pre class="shiki shiki-themes github-light-default dark-plus" style="background-color:#ffffff;--shiki-dark-bg:#0B0C0E;color:#1f2328;--shiki-dark:#D4D4D4" language="${lang}"><code language="${lang}" numberOfLines="${lines}">${inner}\n</code></pre></div>`;
  return (cbHead.replace(/numberOfLines="\d+" language="[^"]*"/, `numberOfLines="${lines}" language="${lang}"`) + shell + cbTail + cbFade + cbClose)
    // keep ids unique-ish and harmless
    .replace(/data-chat-payload-element-id="[^"]*"/, `data-chat-payload-element-id="lang-${lang}"`);
}

const hr = "<hr/>";
const ic = (s) => `<code>${esc(s)}</code>`;

// ---------- ESP32 page body ----------
// Pull short, real excerpts out of the example source so the page can't drift from the code.
const between = (src, from, to) => {
  const i = src.indexOf(from);
  const j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`excerpt markers not found: ${from} .. ${to}`);
  return src.slice(i, j).trimEnd();
};

async function esp32Content() {
  const server = read("server/main.ts");
  const mainCpp = read("firmware/src/main.cpp");
  const config = read("firmware/src/Config.h");
  // Pin numbers come straight from Config.h so the wiring table can't drift from the firmware.
  const pin = (name) => {
    const m = config.match(new RegExp(`^#define ${name} (\\d+)`, "m"));
    if (!m) throw new Error(`pin not found in Config.h: ${name}`);
    return `GPIO ${m[1]} (${ic(name)})`;
  };
  const localConfig = between(config, "// --- Wi-Fi", "// Hosted server");
  const connect = between(mainCpp, "#if RELAY_TLS", "  ws.onEvent(onEvent);");

  const endpoints = between(server, "const STT_URL =", "// Deno's WebSocket");
  const sttLoop = between(server, "  const stt = authedSocket(STT_URL);", "  // --- Text-to-speech");
  const turnLoop = between(server, "  async function drain() {", "  // --- Device -> relay");
  const firmwareIO = between(mainCpp, "// Core 0: read the mic", "void setup()");

  // Fixed-width layout so columns can't drift: [device box] gap [server box] gap [AssemblyAI box]
  const pad = (t, n) => t + " ".repeat(Math.max(0, n - [...t].length));
  const box = (w, rows) => ["┌" + "─".repeat(w) + "┐", ...rows.map((r) => "│" + pad(" " + r, w) + "│"), "└" + "─".repeat(w) + "┘"];
  const dev = box(14, ["INMP441 mic", "", "", "", "", "MAX98357A", "+ speaker"]);
  const relay = box(15, ["turn handling", "chat history", "barge-in", "", "API key lives", "here, not on", "the device"]);
  const aai = box(19, ["Streaming STT", "Universal-3.6 Pro", "─────────────", "LLM Gateway", "─────────────", "Text to Speech", "AssemblyAI-TTS-1"]);
  const g1 = ["", " 16kHz", "──────▶", "", "", "", "◀──────", " 24kHz", ""].map((t) => pad(t, 8));
  const g2 = ["", " wss", "─────▶", "◀─────", " https", "─────▶", "◀─────", " wss", ""].map((t) => pad(t, 7));
  const rows = dev.map((_, i) => dev[i] + g1[i] + relay[i] + g2[i] + aai[i]);
  const diagram = ["  ESP32-S3              Edge server            AssemblyAI", ...rows].join("\n");

  return [
    heading("h2", "overview", "Overview"),
    p(`This guide builds a voice agent on an ESP32-S3 with a microphone and a speaker. You talk, it answers. AssemblyAI handles the speech-to-text, the LLM reply through LLM Gateway, and the text-to-speech. The ESP32 only streams audio to and from a small Deno edge server, and the server talks to AssemblyAI. You can interrupt the agent at any time by talking over it or pressing the button.`),
    p(`The design comes from ${a(ELATO, "Elato")}, an open-source stack for building talking ESP32 devices. The full Elato project ships ESP32 firmware, a Deno edge server, a Next.js app and Supabase, and works with 100+ voice models. The code on this page is a minimal version of it with AssemblyAI as the speech provider, small enough to read in one sitting.`),
    `<div style="display:flex;justify-content:center;margin:1.5rem 0"><iframe src="https://www.youtube.com/embed/FAm6QM6FgiA" title="AssemblyAI voice agent on ESP32 demo" style="width:100%;max-width:340px;aspect-ratio:9/16;border:0;border-radius:12px" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`,
    callout(`Set ${ic("ASSEMBLYAI_API_KEY")} on the edge server only. The key never touches the device. Get one from the ${a("https://www.assemblyai.com/dashboard", "AssemblyAI dashboard")}.`),
    hr,
    heading("h2", "architecture", "Architecture"),
    await code(diagram, "text"),
    table(
      ["Hop", "Protocol", "Notes"],
      [
        ["ESP32 ⇄ edge server", `${ic("ws://")} on your LAN, ${ic("wss://")} when hosted`, `Binary frames carry audio. JSON frames carry ${ic("state")}, ${ic("transcript")}, and ${ic("interrupt")}.`],
        ["Edge server → STT", `${ic("wss://streaming.assemblyai.com/v3/ws")}`, `16 kHz PCM16 in, ${ic("Turn")} events out. ${ic("end_of_turn")} triggers the LLM.`],
        ["Edge server → LLM", `${ic("POST /v1/chat/completions")}`, "OpenAI-compatible LLM Gateway. Change the model with one environment variable."],
        ["Edge server → TTS", `${ic("wss://tts.us.assemblyai.com/v1/ws")}`, `${ic("Generate")} and ${ic("Flush")} in, base64 PCM16 24 kHz out, ${ic("Cancel")} on barge-in.`],
      ],
    ),
    callout(`This example calls STT, LLM Gateway, and TTS separately, so you pick each model: ${ic("universal-3-6-pro")} for STT, any LLM Gateway model through ${ic("LLM_MODEL")}, and a TTS voice. You can also use the managed Voice Agent API instead. See ${a("#voice-agent-api-alternative", "Voice Agent API alternative")}.`),
    hr,
    heading("h2", "hardware", "Hardware"),
    table(
      ["Part", "Purpose"],
      [
        ["ESP32-S3 dev board with Wi-Fi", "Runs the firmware. No PSRAM required."],
        ["INMP441 I2S microphone", "Audio in (I2S port 0)."],
        ["MAX98357A I2S amplifier and small speaker", "Audio out (I2S port 1)."],
        ["Button (the BOOT button works)", "Interrupts the assistant."],
        ["LED (optional)", "Lights up when the agent is listening."],
      ],
    ),
    heading("h3", "wiring", "Wiring"),
    p(`Wire the two I2S boards to the ESP32-S3 as below. These are the defaults in ${ic("Config.h")}. If you use other pins, change them there.`),
    `<figure style="margin:1.5rem 0"><img src="/assets/wiring-diagram.png" alt="Wiring diagram: INMP441 microphone, MAX98357A amplifier with speaker, button and LED connected to an ESP32-S3 board" style="width:100%;height:auto;border-radius:12px" loading="lazy"/><figcaption style="margin-top:.5rem;font-size:.875rem;opacity:.7">Reference wiring from the full Elato build. Red is power, black is ground, green is signal.</figcaption></figure>`,
    callout(`The GPIO numbers in the picture come from the full Elato build. This minimal example uses the pins in the table below, which match ${ic("Config.h")}. Use the table if the two differ.`),
    table(
      ["Module", "Module pin", "ESP32-S3 pin", "Notes"],
      [
        ["INMP441 mic", "VDD", "3V3", "3.3 V only. Don't connect it to 5 V."],
        ["", "GND", "GND", ""],
        ["", "SCK", pin("MIC_BCLK"), "Bit clock."],
        ["", "WS", pin("MIC_WS"), "Word select."],
        ["", "SD", pin("MIC_DIN"), "Audio data from the mic."],
        ["", "L/R", "GND", "Selects the left channel, which the firmware reads. Don't leave it floating."],
        ["MAX98357A amp", "VIN", "5V", "Power the amp from 5 V, not from the 3.3 V regulator."],
        ["", "GND", "GND", ""],
        ["", "BCLK", pin("SPK_BCLK"), "Bit clock."],
        ["", "LRC", pin("SPK_WS"), "Word select."],
        ["", "DIN", pin("SPK_DOUT"), "Audio data to the amp."],
        ["", "+ and −", "Speaker", "4 or 8 Ω speaker. Leave SD and GAIN unconnected."],
        ["Button", "", pin("BUTTON_PIN"), "The on-board BOOT button. No wiring needed."],
        ["LED (optional)", "", pin("LED_PIN"), "On-board LED on many S3 boards."],
      ],
    ),
    p(`The mic and the amp use separate I2S ports, so they don't share clock pins. Keep the jumper wires short and make sure every module shares a ground with the ESP32.`),
    hr,
    heading("h2", "build-the-voice-agent", "Build the voice agent"),
    heading("h3", "step-1-set-your-api-key-and-device-token", "Step 1: Set your API key and device token"),
    p(`The device token is a shared secret between the ESP32 and your edge server.`),
    await code(`export ASSEMBLYAI_API_KEY=<your-key>\nexport DEVICE_TOKEN=$(openssl rand -hex 16)`, "bash"),
    heading("h3", "step-2-run-the-edge-server", "Step 2: Run the edge server"),
    p(`The server is one Deno file, ${ic("examples/esp32-realtime/server/main.ts")}. Start it on your computer first. You deploy it in ${a("#step-5-deploy-and-switch-to-wss", "Step 5")}.`),
    await code(`deno run -A examples/esp32-realtime/server/main.ts`, "bash"),
    p(`A local Deno server speaks plain HTTP on port 8000, so the device reaches it at ${ic("ws://<your-computer-ip>:8000")}. There is no TLS on this hop yet. Check that the server is up:`),
    await code(`curl http://localhost:8000/health   # prints "ok"`, "bash"),
    p(`It talks to three AssemblyAI endpoints. Every one authenticates with your API key.`),
    await code(endpoints, "typescript"),
    p(`STT stays open for the whole session. When a final turn arrives, the server forwards the transcript to the device and, if the agent is mid-reply, cuts it off first.`),
    await code(sttLoop, "typescript"),
    p(`Replies are handled one at a time: ask the LLM, then speak the answer.`),
    await code(turnLoop, "typescript"),
    heading("h3", "step-3-flash-the-firmware", "Step 3: Flash the firmware"),
    p(`The ESP32 can't use ${ic("localhost")}. It needs your computer's address on the local network. Find it:`),
    await code(`ipconfig getifaddr en0   # macOS\nhostname -I              # Linux\nipconfig                 # Windows, look for "IPv4 Address"`, "bash"),
    p(`Open ${ic("examples/esp32-realtime/firmware")} in PlatformIO. In ${ic("Config.h")}, set your Wi-Fi credentials, put that IP address in ${ic("RELAY_HOST")}, and use the same ${ic("DEVICE_TOKEN")} as the server. Leave ${ic("RELAY_PORT")} at ${ic("8000")} and ${ic("RELAY_TLS")} at ${ic("0")}.`),
    await code(localConfig, "cpp"),
    p(`The ESP32 and your computer must be on the same Wi-Fi network, and that network must be 2.4 GHz. Then flash:`),
    await code(`cd examples/esp32-realtime/firmware\npio run -t upload && pio device monitor`, "bash"),
    p(`The firmware has two jobs. One task reads the mic and streams PCM16 to the server. The main loop drains a playback buffer into the speaker, and clears it on interrupt.`),
    await code(firmwareIO, "cpp"),
    heading("h3", "step-4-talk-to-it", "Step 4: Talk to it"),
    p(`When the serial monitor prints ${ic("server connected")}, start talking. Transcripts show up in the monitor and the reply plays through the speaker. Press the button, or talk over it, to interrupt.`),
    heading("h3", "step-5-deploy-and-switch-to-wss", "Step 5: Deploy and switch to wss://"),
    p(`So far the device talks to the server over ${ic("ws://")}, which is unencrypted. Anyone on the same network can read the audio and the ${ic("DEVICE_TOKEN")}, which travels in the URL. That's acceptable on your own Wi-Fi while you develop. It isn't acceptable once the traffic crosses the internet.`),
    p(`For a remote server, use ${ic("wss://")}. It's the same WebSocket protocol inside TLS, so the traffic is encrypted and can't be read or changed in transit. You don't add TLS to ${ic("main.ts")}. The host terminates it in front of the same code.`),
    table(
      ["", "Local development", "Hosted server"],
      [
        ["Device connects to", `${ic("ws://192.168.1.100:8000")}`, `${ic("wss://your-relay.deno.dev")}`],
        ["Encryption", "None", "TLS"],
        ["Who provides TLS", `Nobody. ${ic("Deno.serve")} speaks plain HTTP.`, "The host, for example Deno Deploy or a reverse proxy."],
        [ic("RELAY_HOST"), "Your computer's LAN IP", "Your deployment's hostname"],
        [ic("RELAY_PORT"), ic("8000"), ic("443")],
        [ic("RELAY_TLS"), ic("0"), ic("1")],
        ["Use it for", "Development on a network you trust", "Everything else"],
      ],
    ),
    p(`Deploy ${ic("main.ts")} to Deno Deploy or another Deno-compatible host close to your users, and set ${ic("ASSEMBLYAI_API_KEY")} and ${ic("DEVICE_TOKEN")} as environment variables there. Then change three lines in ${ic("Config.h")} and flash again:`),
    await code(`#define RELAY_HOST "your-relay.deno.dev"\n#define RELAY_PORT 443\n#define RELAY_TLS 1`, "cpp"),
    p(`${ic("RELAY_TLS")} picks the connection call in ${ic("main.cpp")}:`),
    await code(connect, "cpp"),
    callout(`TLS only stops a man-in-the-middle attack if the device checks the server's certificate. To keep the example short, the firmware encrypts the connection but doesn't verify the certificate by default. Before you ship, set ${ic("RELAY_CA_CERT")} in ${ic("Config.h")} to your host's root CA certificate. The firmware then refuses any server that can't prove its identity.`),
    p(`The hops from the edge server to AssemblyAI always use ${ic("wss://")} and ${ic("https://")}, in local development too.`),
    hr,
    heading("h2", "how-it-works", "How it works"),
    ul([
      `<strong>Always listening.</strong> The STT socket stays open for the whole session. AssemblyAI's turn detection decides when the user is done (${ic("end_of_turn")}), so there's no push-to-talk.`,
      `<strong>One reply at a time.</strong> Final turns are queued. For each one the server calls LLM Gateway with the running history, then opens a TTS socket for the answer.`,
      `<strong>Barge-in.</strong> If speech arrives while the agent is talking, or the button is pressed, the server sends ${ic("Cancel")} to TTS and an ${ic("interrupt")} to the device, which clears its playback buffer.`,
      `<strong>Raw PCM.</strong> The example sends uncompressed PCM16, about 32 KB/s up and 48 KB/s down. That's fine on Wi-Fi. Elato's firmware compresses audio with Opus, and adding it here is the main upgrade if your network is weak.`,
    ]),
    hr,
    heading("h2", "limitations", "Limitations"),
    p(`After running this design and the ${a(ELATO, "Elato")} framework on hundreds of ESP32 devices, these were the limits documented by Akash Deb, founder of Elato:`),
    ul([
      `<strong>Cold starts.</strong> Connecting to a freshly started edge server takes about 2 to 3 seconds.`,
      `<strong>Response time.</strong> About 1 second end to end, which is fast. That covers Wi-Fi, network distance, model time and playback, so yours will vary with your hardware, region and LLM. Measure it on your own setup.`,
      `<strong>Session length.</strong> Edge hosts end a connection when their wall-clock limit is reached. Elato has tested up to 17 minutes of uninterrupted conversation.`,
      `<strong>Interruptions.</strong> The ESP32 doesn't detect speech itself. It stops playing only when the server sends ${ic("interrupt")} or you press the button.`,
    ]),
    p(`Two more limits are specific to this example. It sends raw PCM, so it needs a steady Wi-Fi link. And ${ic("DEVICE_TOKEN")} is one shared secret for every device, which is fine for a prototype. Give each device its own credentials before you ship, as Elato does with its Supabase device registration.`),
    hr,
    heading("h2", "troubleshooting", "Troubleshooting"),
    p(`Most problems are Wi-Fi, wiring or power. Keep the serial monitor open with ${ic("pio device monitor")}. It shows how far the device got: dots while it joins Wi-Fi, then ${ic("Wi-Fi connected")}, then ${ic("server connected")}, then your transcripts.`),
    heading("h3", "wi-fi-never-connects", "Wi-Fi never connects"),
    p(`The serial monitor prints dots and never reaches ${ic("Wi-Fi connected")}.`),
    ul([
      `<strong>Use a 2.4 GHz network.</strong> The ESP32-S3 can't see 5 GHz Wi-Fi. If your router puts both bands under one name and the device won't join, create a separate 2.4 GHz network. On an iPhone hotspot, turn on Maximize Compatibility.`,
      `<strong>Check the credentials.</strong> ${ic("WIFI_SSID")} and ${ic("WIFI_PASS")} are case-sensitive. Networks with a login page or a username, like hotel and office Wi-Fi, don't work with this firmware.`,
      `<strong>Power-cycle the board</strong> after you change Wi-Fi credentials.`,
    ]),
    heading("h3", "server-never-connects", "Server never connects"),
    p(`You see ${ic("Wi-Fi connected")} but not ${ic("server connected")}. The device retries every 2 seconds without printing an error.`),
    ul([
      `<strong>${ic("ws://")} and ${ic("wss://")} are mixed up.</strong> A local Deno server only accepts ${ic("ws://")}, so ${ic("RELAY_TLS")} must be ${ic("0")} with port ${ic("8000")}. A hosted server only accepts ${ic("wss://")}, so ${ic("RELAY_TLS")} must be ${ic("1")} with port ${ic("443")}.`,
      `<strong>The device can't reach your computer.</strong> ${ic("RELAY_HOST")} must be your computer's LAN IP, not ${ic("localhost")}. From a phone on the same Wi-Fi, open ${ic("http://<your-computer-ip>:8000/health")}. If it doesn't load, allow incoming connections for Deno in your firewall, and avoid guest networks, which often block devices from reaching each other.`,
      `<strong>The token doesn't match.</strong> ${ic("DEVICE_TOKEN")} must be the same in ${ic("Config.h")} and in the server's environment. The server rejects every device if you start it without ${ic("DEVICE_TOKEN")} set.`,
    ]),
    heading("h3", "no-transcripts-from-the-mic", "No transcripts from the mic"),
    p(`The server connects, but nothing you say shows up in the serial monitor.`),
    ul([
      `<strong>Recheck the three I2S wires.</strong> SCK, WS and SD must go to the pins in the ${a("#wiring", "wiring table")}. One wire in the wrong place gives silence, not an error.`,
      `<strong>Tie L/R to GND.</strong> The firmware reads the left channel. A floating L/R pin gives silence or noise.`,
      `<strong>Power the mic from 3V3</strong> and check that its ground reaches the ESP32.`,
      `<strong>Shorten the wires.</strong> Long or loose jumper wires corrupt the I2S clock. Reseat them or solder the connections.`,
    ]),
    heading("h3", "no-sound-from-the-speaker", "No sound from the speaker"),
    p(`You see the assistant's reply in the serial monitor but hear nothing, or only static.`),
    ul([
      `<strong>Recheck BCLK, LRC and DIN.</strong> Swapping BCLK and LRC is the most common mistake.`,
      `<strong>Leave the amp's SD pin unconnected.</strong> Tying it to GND shuts the amp down.`,
      `<strong>Test the speaker on its own.</strong> Get a small internet-radio sketch playing through the MAX98357A. If the radio plays, your wiring and I2S pins are fine and the problem is in the audio stream. If it doesn't, recheck the pins in ${ic("Config.h")}.`,
    ]),
    heading("h3", "board-resets-or-audio-crackles", "Board resets or audio crackles"),
    p(`The board reboots when Wi-Fi connects or when the assistant starts speaking, and the serial monitor may print ${ic("Brownout detector was triggered")}. This is a USB brownout. Wi-Fi transmission and the amplifier draw current in bursts, and a weak USB port or a thin cable can't keep the voltage up.`),
    ul([
      `<strong>Change the cable and the port.</strong> Use a short, good-quality USB cable plugged straight into your computer or a 5 V supply rated for 1 A or more. Avoid unpowered hubs.`,
      `<strong>Power the amp from the 5V pin.</strong> On 3V3 it shares the regulator with the ESP32 and pulls the voltage down.`,
      `<strong>Add a capacitor.</strong> 470 µF or more across the amp's VIN and GND absorbs the current spikes.`,
      `<strong>Lower the load.</strong> An 8 Ω speaker draws less current than a 4 Ω one.`,
    ]),
    hr,
    heading("h2", "voice-agent-api-alternative", "Voice Agent API alternative"),
    p(`Instead of chaining three APIs, the edge server can open one WebSocket to the managed ${a("https://www.assemblyai.com/docs/voice-agents/voice-agent-api", "Voice Agent API")} and let AssemblyAI run the whole loop. Elato supports both, so you can choose per character.`),
    table(
      ["", "STT + LLM Gateway + TTS (this example)", "Voice Agent API"],
      [
        ["Connections", "Three: STT socket, LLM Gateway request, TTS socket", `One: ${ic("wss://agents.assemblyai.com/v1/ws")}`],
        ["Models", `You choose: ${ic("universal-3-6-pro")}, an LLM Gateway model, a TTS voice`, "Managed by AssemblyAI. You choose the voice and, optionally, a transcription mode."],
        ["Turn-taking", `The server reacts to ${ic("end_of_turn")}, then calls the LLM and TTS`, "Handled by AssemblyAI (semantic turn detection and barge-in)"],
        ["Audio", "16 kHz PCM16 in, 24 kHz PCM16 out", "24 kHz PCM in and out. Resample 16 kHz mic audio before sending."],
        ["Tools", "You call tools yourself in the server", `Declare them in ${ic("session.update")}, run them in the server, send the results back`],
        ["Greeting", "The server generates and speaks it", `The model composes it from a ${ic("reply.create")} instruction`],
        ["Ending a call", "Close the sockets", `Send ${ic("session.end")} so you aren't billed for the reconnect grace window`],
      ],
    ),
    p(`You configure the session with one ${ic("session.update")} event: ${ic("system_prompt")}, ${ic("input.format")}, ${ic("output.voice")}, ${ic("output.format")}, and ${ic("tools")}. The voice and output format can't change after the first update. The agent speaks English, Italian, Spanish, German, Portuguese and French. Your API key needs Voice Agent API access, not only streaming transcription. The Voice Agent API doesn't expose its STT, LLM or TTS models, so use the pipeline above if you need to pin or swap one.`),
    hr,
    heading("h2", "customize-and-extend", "Customize and extend"),
    ul([
      `Change the persona with ${ic("SYSTEM_PROMPT")}, the model with ${ic("LLM_MODEL")}, and the voice with ${ic("TTS_VOICE_ID")}.`,
      `Add tool calls (timers, smart-home actions) to the LLM Gateway request and run them in the server.`,
      `Add keyterms for your product names to the STT connection to improve recognition.`,
      `Use the full Elato project for the Next.js app and Supabase schema that handle device registration, characters, and conversation history.`,
      `Deploy the server near your users. End-to-end latency is Wi-Fi, network distance, model time, and playback, so measure on your hardware and region.`,
    ]),
    hr,
    heading("h2", "next-steps", "Next steps"),
    ul([
      `${a(ELATO, "ElatoAI on GitHub")} — The full open-source project: firmware, Deno edge server, and web app`,
      `${a("https://www.assemblyai.com/docs/streaming/getting-started/transcribe-streaming-audio", "Realtime STT quickstart")} — Set up realtime transcription`,
      `${a("https://www.assemblyai.com/docs/llm-gateway/quickstart", "LLM Gateway overview")} — Explore all available models and features`,
      `${a("https://developers.openai.com/cookbook/examples/voice_solutions/running_realtime_api_speech_on_esp32_arduino_edge_runtime_elatoai", "OpenAI Cookbook: Realtime API on ESP32 with Elato")} and ${a("https://www.boson.ai/blog/higgs-realtime-esp32", "Boson AI: Higgs Realtime on ESP32")} — The Elato stack running on OpenAI's Realtime API and on Boson's Higgs Realtime`,
    ]),
  ].join("\n");
}

async function overviewContent() {
  return [
    heading("h2", "overview", "Overview"),
    p(`Each example below is a self-contained pipeline that wires together several AssemblyAI products into a working application. Run one, see the polished output, and customize from there.`),
    callout(`Every example uses placeholder API keys (${ic("YOUR_API_KEY")}). Replace them with your actual key from the ${a("https://www.assemblyai.com/dashboard", "AssemblyAI dashboard")}.`),
    hr,
    heading("h2", "streaming-pipelines", "Streaming pipelines"),
    p(`These pipelines use the Realtime STT API to process live audio, with LLM Gateway and Text to Speech.`),
    table(
      ["Pipeline", "Products used", "Best for"],
      [[`<a href="${ESP32_PATH}" class="link">${PAGE_TITLE}</a>`, "Realtime STT + LLM Gateway + Text to Speech + Elato", "Voice toys, assistants, embedded devices"]],
    ),
    hr,
    heading("h2", "customize-and-extend", "Customize and extend"),
    p(`Every pipeline is a starting point. Common ways to build on them:`),
    ul([
      `Swap LLM models by changing the ${ic("model")} parameter in LLM Gateway requests.`,
      `Change the voice or persona without reflashing the device.`,
      `Add tool calls to act on what the user says.`,
    ]),
    hr,
    heading("h2", "next-steps", "Next steps"),
    ul([
      `${a("https://www.assemblyai.com/docs/streaming/getting-started/transcribe-streaming-audio", "Realtime STT quickstart")} — Set up realtime transcription`,
      `${a("https://www.assemblyai.com/docs/llm-gateway/quickstart", "LLM Gateway overview")} — Explore all available models and features`,
    ]),
  ].join("\n");
}

// ---------- assemble full-page HTML from the real one ----------
const tocItem = (id, text, depth = 0, first = false) =>
  `<li class="toc-item" data-layout-item="toc-item" data-depth="${depth}"${first ? ' data-active="true"' : ""}><a data-layout-item="toc-item-link" href="#${id}">${text}</a></li>`;

function build({ title, subtitle, path, content, toc, sidebarActiveChild, prev, next }) {
  let b = ref.slice(ref.indexOf("<body"), ref.lastIndexOf("</body>"));
  b = b.replace(/^<body[^>]*>/, "");
  b = b.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<template[\s\S]*?<\/template>/g, "");
  b = b.replace(/<link rel="preload"[^>]*>/g, "").replace(/<link [^>]*data-mint-katex[^>]*>/g, "");

  // self-host assets
  b = b.replace(/https:\/\/mintcdn\.com\/[^"')]*assemblyai-lockup-primary\.svg[^"')]*/g, "/assets/assemblyai-lockup-primary.svg");
  b = b.replace(/https:\/\/mintcdn\.com\/[^"')]*assemblyai-lockup-secondary\.svg[^"')]*/g, "/assets/assemblyai-lockup-secondary.svg");
  b = b.replaceAll("https://www.assemblyai.com/_aai/fonts/", "/_aai/fonts/");
  b = b.replaceAll('url("https://www.assemblyai.com/docs/assets/', 'url("/_aai/fonts/rebrand/');

  // links that point at pages we don't have go to the live docs
  b = b.replace(/href="(\/docs[^"]*)"/g, (m, h) => (h === ESP32_PATH ? m : `href="https://www.assemblyai.com${h}"`));

  // sidebar: End-to-end examples group keeps only the ESP32 child
  const gStart = b.indexOf('<li data-title="End-to-end examples"');
  const ulStart = b.indexOf("<ul", b.indexOf("</button>", gStart));
  const ulEnd = b.indexOf("</ul>", ulStart) + 5;
  const ulHtml = b.slice(ulStart, ulEnd);
  const firstLi = ulHtml.match(/<li id="[^"]*meeting-notetaker"[\s\S]*?<\/li>/)[0]; // template only
  const ACTIVE = "bg-primary/10 text-primary [text-shadow:-0.2px_0_0_currentColor,0.2px_0_0_currentColor] dark:text-primary-light dark:bg-primary-light/10";
  const IDLE = "hover:bg-gray-600/5 dark:hover:bg-gray-200/5 text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-300";
  let child = firstLi
    .replaceAll("meeting-notetaker", "realtime-esp32").replaceAll("Meeting notetaker", PAGE_TITLE)
    .replace(/href="[^"]*"/, `href="${ESP32_PATH}"`);
  if (sidebarActiveChild) {
    child = child.replace(IDLE, ACTIVE).replace("<a ", '<a data-active-nav-item="true" aria-current="page" ');
  }
  const newUl = ulHtml.slice(0, ulHtml.lastIndexOf("</ul>")) + child + "</ul>";
  b = b.slice(0, ulStart) + newUl + b.slice(ulEnd);
  if (sidebarActiveChild) {
    // group header is no longer the active page
    b = b.replace(ACTIVE + '" style="padding-left:1rem" data-active-nav-item="true" aria-expanded="true"', IDLE + '" style="padding-left:1rem" aria-expanded="true"');
    b = b.replace('data-title="End-to-end examples" data-group-tag="" data-active="true"', 'data-title="End-to-end examples" data-group-tag=""');
  }

  // TOC
  b = b.replace(/(<ul id="table-of-contents-content"[^>]*>)[\s\S]*?(<\/ul>)/, `$1${toc.map((t, i) => tocItem(t[0], t[1], t[2] ?? 0, i === 0)).join("")}$2`);

  // header
  const crumb = path === ESP32_PATH ? "End-to-end examples" : "End-to-end examples";
  b = b.replace(/(<div class="eyebrow[^>]*>)[^<]*/, (_, o) => o + crumb);
  b = b.replace(/(<h1 id="page-title"[^>]*>)[^<]*/, (_, o) => o + title);
  b = b.replace(/(<div class="mt-2 text-lg prose[^>]*>)<p>[^<]*<\/p>/, (_, o) => `${o}<p>${subtitle}</p>`);
  b = b.replace(/data-page-title="[^"]*" data-page-href="[^"]*"/, `data-page-title="${title}" data-page-href="${path.replace("/docs", "")}"`);

  // content
  const cStart = b.indexOf('<div class="mdx-content');
  const cOpenEnd = b.indexOf(">", cStart) + 1;
  const cEnd = b.indexOf('</div><div class="feedback-toolbar');
  b = b.slice(0, cOpenEnd) + "\n" + content + "\n" + b.slice(cEnd);

  // pagination
  b = b.replace(/(<a href=")[^"]*("[^>]*rel="prev"[\s\S]*?pagination-title">)[^<]*/, `$1${prev.href}$2${prev.title}`);
  if (next) {
    b = b.replace(/(<a href=")[^"]*("[^>]*rel="next"[\s\S]*?pagination-title[^>]*>)[^<]*/, `$1${next.href}$2${next.title}`);
  } else {
    b = b.replace(/<a href="[^"]*"[^>]*rel="next"[\s\S]*?<\/a>(<\/nav>)/, "$1");
  }
  return b;
}

const esp32Toc = [
  ["overview", "Overview"], ["architecture", "Architecture"], ["hardware", "Hardware"], ["wiring", "Wiring", 1],
  ["build-the-voice-agent", "Build the voice agent"],
  ["step-1-set-your-api-key-and-device-token", "Step 1: Set your API key and device token", 1],
  ["step-2-run-the-edge-server", "Step 2: Run the edge server", 1],
  ["step-3-flash-the-firmware", "Step 3: Flash the firmware", 1],
  ["step-4-talk-to-it", "Step 4: Talk to it", 1],
  ["step-5-deploy-and-switch-to-wss", "Step 5: Deploy and switch to wss://", 1],
  ["how-it-works", "How it works"], ["limitations", "Limitations"],
  ["troubleshooting", "Troubleshooting"],
  ["wi-fi-never-connects", "Wi-Fi never connects", 1],
  ["server-never-connects", "Server never connects", 1],
  ["no-transcripts-from-the-mic", "No transcripts from the mic", 1],
  ["no-sound-from-the-speaker", "No sound from the speaker", 1],
  ["board-resets-or-audio-crackles", "Board resets or audio crackles", 1],
  ["voice-agent-api-alternative", "Voice Agent API alternative"],
  ["customize-and-extend", "Customize and extend"], ["next-steps", "Next steps"],
];

writeFileSync("content/realtime-esp32.html", build({
  title: PAGE_TITLE,
  subtitle: "Build a voice agent on a $10 ESP32-S3 with Elato and AssemblyAI streaming Speech-to-Text, LLM Gateway, and Text to Speech.",
  path: ESP32_PATH, content: await esp32Content(), toc: esp32Toc, sidebarActiveChild: true,
  prev: { href: "https://www.assemblyai.com/docs/getting-started/end-to-end-examples/real-time-live-captioner", title: "Realtime live captioner" }, next: null,
}));

console.log("generated");
