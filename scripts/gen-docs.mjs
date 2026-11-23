// Generates content/*.html from the saved copy of the real AssemblyAI docs page
// (reference/end-to-end-examples.html) so markup, classes and CSS match exactly.
// Run: node scripts/gen-docs.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { codeToHtml } from "shiki";
import MarkdownIt from "markdown-it";

const ref = readFileSync("reference/end-to-end-examples.html", "utf8");
const stream = readFileSync("reference/streaming-quickstart.html", "utf8");
// Code excerpts and pin numbers come from a checkout of ElatoAI, so the page follows the real repo.
// Override the location with ELATO_DIR=/path/to/ElatoAI.
const ELATO_DIR = process.env.ELATO_DIR ?? "../../ElatoAI";
const read = (p) => readFileSync(`${ELATO_DIR}/${p}`, "utf8");

const ESP32_PATH = "/docs/getting-started/end-to-end-examples/realtime-esp32";
const E2E_PATH = "/docs/getting-started/end-to-end-examples";
const ELATO = "https://github.com/akdeb/ElatoAI";
// The page content lives in content/realtime-esp32.md (title and subtitle in its front matter).
const mdSource = readFileSync("content/realtime-esp32.md", "utf8");
const fm = mdSource.match(/^---\n([\s\S]*?)\n---\n/);
const meta = Object.fromEntries(fm[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
const MD_BODY = mdSource.slice(fm[0].length);
const PAGE_TITLE = meta.title;

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

// ---------- ESP32 page body (rendered from content/realtime-esp32.md) ----------
// Code blocks with file="" are excerpts of the real example source, so the page can't drift from the code.
const between = (src, from, to) => {
  const i = src.indexOf(from);
  const j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`excerpt markers not found: ${from} .. ${to}`);
  return src.slice(i, j).trimEnd();
};

const md = new MarkdownIt({ html: true });
md.renderer.rules.text = (t, i) => esc(t[i].content);
md.renderer.rules.code_inline = (t, i) => ic(t[i].content);
md.renderer.rules.link_open = (t, i) => `<a href="${t[i].attrGet("href")}" target="_blank" rel="noreferrer" class="link">`;
const inline = (tok) => md.renderer.renderInline(tok.children, md.options, {});
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function esp32Content() {
  // This guide is for the INMP441 + MAX98357A devkit. Config.cpp also has an
  // `#ifdef ELATO_BOARD_VOICE_V1 ... #else` block with another board's pins: drop it so the
  // wiring table always shows the devkit pins, whichever ElatoAI branch is checked out.
  const config = read("firmware-arduino/src/Config.cpp").replace(/#ifdef ELATO_BOARD_VOICE_V1[\s\S]*?#else\n/g, "");
  // {{pin:NAME}} -> "GPIO n (`NAME`)", from firmware-arduino/src/Config.cpp so the wiring table can't drift from the firmware.
  const body = MD_BODY.replace(/\{\{pin:(\w+)\}\}/g, (_, name) => {
    const m = config.match(new RegExp(`^const [\\w:]+ ${name} = (?:GPIO_NUM_)?(\\d+);`, "m"));
    if (!m) throw new Error(`pin not found in Config.cpp: ${name}`);
    return `GPIO ${m[1]} (\`${name}\`)`;
  });

  const tokens = md.parse(body, {});
  const out = [];
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case "heading_open": {
        const tag = t.tag;
        const m = tokens[i + 1].content.match(/^(.*?)(?:\s*\{#([\w-]+)\})?$/);
        const text = m[1];
        const id = m[2] ?? slug(text);
        toc.push([id, text, tag === "h3" ? 1 : 0]);
        out.push(heading(tag, id, text));
        i += 2;
        break;
      }
      case "paragraph_open":
        out.push(p(inline(tokens[i + 1])));
        i += 2;
        break;
      case "bullet_list_open": {
        const items = [];
        for (i++; tokens[i].type !== "bullet_list_close"; i++) {
          if (tokens[i].type === "inline") items.push(inline(tokens[i]));
        }
        out.push(ul(items));
        break;
      }
      case "table_open": {
        const rows = [];
        let row;
        for (i++; tokens[i].type !== "table_close"; i++) {
          if (tokens[i].type === "tr_open") rows.push((row = []));
          if (tokens[i].type === "inline") row.push(inline(tokens[i]));
        }
        out.push(table(rows[0], rows.slice(1)));
        break;
      }
      case "blockquote_open": {
        const inl = tokens[i + 2];
        out.push(callout(inline(inl).replace(/^\[!NOTE\]\s*/, "")));
        while (tokens[i].type !== "blockquote_close") i++;
        break;
      }
      case "hr":
        out.push(hr);
        break;
      case "fence": {
        const lang = t.info.trim().split(/\s+/)[0];
        const attrs = Object.fromEntries([...t.info.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
        const src = attrs.file ? between(read(attrs.file), attrs.from, attrs.to) : t.content;
        out.push(await code(src, lang));
        break;
      }
      case "html_block":
        if (!t.content.startsWith("<!--")) out.push(t.content.trim());
        break;
      default:
        throw new Error(`unsupported markdown in realtime-esp32.md: ${t.type} (line ${t.map?.[0] + 1})`);
    }
  }
  return { html: out.join("\n"), toc };
}

async function overviewContent() {
  return [
    heading("h2", "overview", "Overview"),
    p(`Each example below is a self-contained pipeline that wires together several AssemblyAI products into a working application. Run one, see the polished output, and customize from there.`),
    callout(`Every example uses placeholder API keys (${ic("YOUR_API_KEY")}). Replace them with your actual key from the ${a("https://www.assemblyai.com/dashboard", "AssemblyAI dashboard")}.`),
    hr,
    heading("h2", "streaming-pipelines", "Streaming pipelines"),
    p(`These pipelines use the Realtime STT API to process live audio, with LLM Gateway and Text-to-Speech.`),
    table(
      ["Pipeline", "Products used", "Best for"],
      [[`<a href="${ESP32_PATH}" class="link">${PAGE_TITLE}</a>`, "Realtime STT + LLM Gateway + Text-to-Speech + Elato", "Voice toys, assistants, embedded devices"]],
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

const esp32 = await esp32Content();
writeFileSync("content/realtime-esp32.html", build({
  title: PAGE_TITLE,
  subtitle: meta.subtitle,
  path: ESP32_PATH, content: esp32.html, toc: esp32.toc, sidebarActiveChild: true,
  prev: { href: "https://www.assemblyai.com/docs/getting-started/end-to-end-examples/real-time-live-captioner", title: "Realtime live captioner" }, next: null,
}));

console.log("generated");
