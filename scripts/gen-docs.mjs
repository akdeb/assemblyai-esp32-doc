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
async function esp32Content() {
  const server = read("server/main.ts");
  const mainCpp = read("firmware/src/main.cpp");
  const config = read("firmware/src/Config.h");
  const pio = read("firmware/platformio.ini");

  // Fixed-width layout so columns can't drift: [device box] gap [relay box] gap [AssemblyAI box]
  const pad = (t, n) => t + " ".repeat(Math.max(0, n - [...t].length));
  const box = (w, rows) => ["┌" + "─".repeat(w) + "┐", ...rows.map((r) => "│" + pad(" " + r, w) + "│"), "└" + "─".repeat(w) + "┘"];
  const dev = box(14, ["INMP441 mic", "", "", "", "", "MAX98357A", "+ speaker"]);
  const relay = box(15, ["turn handling", "chat history", "barge-in", "", "API key lives", "here, not on", "the device"]);
  const aai = box(18, ["Streaming STT", "Universal-3 Pro", "─────────────", "LLM Gateway", "─────────────", "Text to Speech", "AssemblyAI-TTS-1"]);
  const g1 = ["", " 16kHz", "──────▶", "", "", "", "◀──────", " 24kHz", ""].map((t) => pad(t, 8));
  const g2 = ["", " wss", "─────▶", "◀─────", " https", "─────▶", "◀─────", " wss", ""].map((t) => pad(t, 7));
  const rows = dev.map((_, i) => dev[i] + g1[i] + relay[i] + g2[i] + aai[i]);
  const diagram = ["  ESP32-S3              Deno relay             AssemblyAI", ...rows].join("\n");

  return [
    heading("h2", "overview", "Overview"),
    p(`This pipeline runs a voice agent on an ESP32-S3, a roughly $10 microcontroller that can capture and play audio but can't run a speech model. The device streams microphone audio to a small Deno relay. The relay transcribes it live with AssemblyAI streaming Speech-to-Text, generates a reply with LLM Gateway, synthesizes speech with Text to Speech, and streams the audio back to the speaker. Interrupt it mid-sentence and it stops.`),
    p(`The firmware and relay architecture come from ${a(ELATO, "ElatoAI")}, the open-source stack for realtime voice agents on ESP32 (Arduino firmware, Deno edge server, Next.js app, and Supabase). This example is a minimal, standalone version of it with AssemblyAI as the speech provider.`),
    callout(`Set ${ic("ASSEMBLYAI_API_KEY")} on the relay only. The key never touches the device. Get one from the ${a("https://www.assemblyai.com/dashboard", "AssemblyAI dashboard")}.`),
    hr,
    heading("h2", "architecture", "Architecture"),
    await code(diagram, "text"),
    table(
      ["Hop", "Protocol", "Notes"],
      [
        ["ESP32 ⇄ relay", "Secure WebSocket", `Binary frames carry audio. JSON frames carry ${ic("state")}, ${ic("transcript")}, and ${ic("interrupt")}.`],
        ["Relay → STT", `${ic("wss://streaming.assemblyai.com/v3/ws")}`, `16 kHz PCM16 in, ${ic("Turn")} events out. ${ic("end_of_turn")} triggers the LLM.`],
        ["Relay → LLM", `${ic("POST /v1/chat/completions")}`, "OpenAI-compatible LLM Gateway. Swap models with one environment variable."],
        ["Relay → TTS", `${ic("wss://tts.us.assemblyai.com/v1/ws")}`, `${ic("Generate")} and ${ic("Flush")} in, base64 PCM16 24 kHz out, ${ic("Cancel")} on barge-in.`],
      ],
    ),
    hr,
    heading("h2", "hardware", "Hardware"),
    table(
      ["Part", "Purpose"],
      [
        ["ESP32-S3 dev board with Wi-Fi", "Runs the firmware. No PSRAM required."],
        ["INMP441 I2S microphone", "Audio in (I2S port 0)."],
        ["MAX98357A I2S amplifier and small speaker", "Audio out (I2S port 1)."],
        ["Button (the BOOT button works)", "Interrupts the assistant."],
        ["LED (optional)", "Shows when the agent is listening."],
      ],
    ),
    p(`Pin assignments live in ${ic("Config.h")}. Change them to match your wiring.`),
    hr,
    heading("h2", "build-the-voice-agent", "Build the voice agent"),
    heading("h3", "step-1-set-your-api-key-and-device-token", "Step 1: Set your API key and device token"),
    p(`The device token is a shared secret between the ESP32 and your relay.`),
    await code(`export ASSEMBLYAI_API_KEY=<your-key>\nexport DEVICE_TOKEN=$(openssl rand -hex 16)`, "bash"),
    heading("h3", "step-2-run-the-relay", "Step 2: Run the relay"),
    p(`The relay is a single Deno file at ${ic("examples/esp32-realtime/server/main.ts")}. Run it locally, or deploy it to any Deno-compatible edge host to cut latency.`),
    await code(`deno run -A examples/esp32-realtime/server/main.ts`, "bash"),
    await code(server, "typescript"),
    heading("h3", "step-3-flash-the-firmware", "Step 3: Flash the firmware"),
    p(`Open ${ic("examples/esp32-realtime/firmware")} in PlatformIO. Set your Wi-Fi credentials, relay host, and the same ${ic("DEVICE_TOKEN")} in ${ic("Config.h")}.`),
    await code(config, "cpp"),
    await code(pio, "ini"),
    await code(mainCpp, "cpp"),
    await code(`cd examples/esp32-realtime/firmware\npio run -t upload && pio device monitor`, "bash"),
    heading("h3", "step-4-talk-to-it", "Step 4: Talk to it"),
    p(`When the serial monitor prints ${ic("relay connected")}, start speaking. Transcripts appear in the monitor and the reply plays through the speaker. Press the button, or just talk over it, to interrupt.`),
    hr,
    heading("h2", "how-it-works", "How it works"),
    ul([
      `<strong>Always listening.</strong> The STT socket stays open for the whole session. AssemblyAI's turn detection decides when you've finished (${ic("end_of_turn")}), so no push-to-talk is needed.`,
      `<strong>One reply at a time.</strong> Final turns are queued. The relay calls LLM Gateway with the running history, then opens a TTS socket for each answer.`,
      `<strong>Barge-in.</strong> If speech arrives while the agent is talking, or the button is pressed, the relay sends ${ic("Cancel")} to TTS and an ${ic("interrupt")} to the device, which clears its playback buffer immediately.`,
      `<strong>Raw PCM.</strong> For clarity the example moves uncompressed PCM16, about 32 KB/s up and 48 KB/s down, which is fine on Wi-Fi. Elato compresses with Opus for weaker networks, and adding it is the main upgrade path.`,
    ]),
    hr,
    heading("h2", "customize-and-extend", "Customize and extend"),
    ul([
      `Change the persona with ${ic("SYSTEM_PROMPT")}, the model with ${ic("LLM_MODEL")}, and the voice with ${ic("TTS_VOICE_ID")}.`,
      `Add tool calls (timers, smart-home actions) to the LLM Gateway request and run them in the relay.`,
      `Add keyterms for your product names to the STT connection to improve recognition.`,
      `Use Elato's Next.js app and Supabase schema for device registration, characters, and conversation history.`,
      `Deploy the relay close to your users. End-to-end latency includes Wi-Fi, network distance, model time, and playback, so measure on your hardware and region.`,
    ]),
    hr,
    heading("h2", "next-steps", "Next steps"),
    ul([
      `${a(ELATO, "ElatoAI on GitHub")} — Firmware, Deno edge server, and web app this example builds on`,
      `${a("https://www.assemblyai.com/docs/streaming/getting-started/transcribe-streaming-audio", "Real-time STT quickstart")} — Set up real-time transcription`,
      `${a("https://www.assemblyai.com/docs/llm-gateway/quickstart", "LLM Gateway overview")} — Explore all available models and features`,
      `${a("https://developers.openai.com/cookbook/examples/voice_solutions/running_realtime_api_speech_on_esp32_arduino_edge_runtime_elatoai", "OpenAI Cookbook: Realtime API on ESP32 with Elato")} and ${a("https://www.boson.ai/blog/higgs-realtime-esp32", "Boson AI: Higgs Realtime on ESP32")} — The same Elato stack with other providers`,
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
    p(`These pipelines use the Real-time STT API to process live audio, with LLM Gateway and Text to Speech.`),
    table(
      ["Pipeline", "Products used", "Best for"],
      [[`<a href="${ESP32_PATH}" class="link">Real-time speech on ESP32</a>`, "Real-time STT + LLM Gateway + Text to Speech + Elato", "Voice toys, assistants, embedded devices"]],
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
      `${a("https://www.assemblyai.com/docs/streaming/getting-started/transcribe-streaming-audio", "Real-time STT quickstart")} — Set up real-time transcription`,
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
    .replaceAll("meeting-notetaker", "realtime-esp32").replaceAll("Meeting notetaker", "Real-time speech on ESP32")
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
  ["overview", "Overview"], ["architecture", "Architecture"], ["hardware", "Hardware"],
  ["build-the-voice-agent", "Build the voice agent"],
  ["step-1-set-your-api-key-and-device-token", "Step 1: Set your API key and device token", 1],
  ["step-2-run-the-relay", "Step 2: Run the relay", 1],
  ["step-3-flash-the-firmware", "Step 3: Flash the firmware", 1],
  ["step-4-talk-to-it", "Step 4: Talk to it", 1],
  ["how-it-works", "How it works"], ["customize-and-extend", "Customize and extend"], ["next-steps", "Next steps"],
];

writeFileSync("content/realtime-esp32.html", build({
  title: "Real-time speech on ESP32",
  subtitle: "Run a voice agent on a $10 ESP32-S3 with AssemblyAI streaming Speech-to-Text, LLM Gateway, and Text to Speech, relayed through an Elato Deno edge server.",
  path: ESP32_PATH, content: await esp32Content(), toc: esp32Toc, sidebarActiveChild: true,
  prev: { href: "https://www.assemblyai.com/docs/getting-started/end-to-end-examples/real-time-live-captioner", title: "Real-time live captioner" }, next: null,
}));

console.log("generated");
