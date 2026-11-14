# AssemblyAI docs replica: Realtime speech on ESP32

Next.js 16 app that reproduces the AssemblyAI docs "End-to-end examples" layout using the real
site's compiled CSS, fonts (GT Standard, Modern Gothic Mono) and markup, with one example:
**Realtime speech on ESP32** (built on [ElatoAI](https://github.com/akdeb/ElatoAI)).

```bash
npm install && npm run dev      # http://localhost:3000  (redirects to the ESP32 page)
```

- `examples/esp32-realtime/`: the earlier standalone example. The page no longer uses it; it follows ElatoAI instead.
- `content/realtime-esp32.md`: **the doc you edit.** Plain Markdown (see the comment at the top of the file for the few extras).
- `scripts/gen-docs.mjs`: renders that Markdown into `content/realtime-esp32.html` using the real AssemblyAI page markup
  (`reference/*.html`) and pulls code excerpts and pin numbers from a checkout of
  [ElatoAI](https://github.com/akdeb/ElatoAI) (expected at `../../ElatoAI`, or set `ELATO_DIR`). Run `node scripts/gen-docs.mjs` after editing the
  Markdown or the example code. Don't edit the generated `.html`.

The copied stylesheet, fonts and logos under `public/` belong to AssemblyAI: for local preview only.
