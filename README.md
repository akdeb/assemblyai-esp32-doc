# AssemblyAI docs replica: Real-time speech on ESP32

Next.js 16 app that reproduces the AssemblyAI docs "End-to-end examples" layout using the real
site's compiled CSS, fonts (GT Standard, Modern Gothic Mono) and markup, with one example:
**Real-time speech on ESP32** (built on [ElatoAI](https://github.com/akdeb/ElatoAI)).

```bash
npm install && npm run dev      # http://localhost:3000  (redirects to the ESP32 page)
```

- `examples/esp32-realtime/server/main.ts`: Deno relay (ESP32 <-> AssemblyAI STT / LLM Gateway / TTS)
- `examples/esp32-realtime/firmware/`: PlatformIO ESP32-S3 firmware
- `scripts/gen-docs.mjs`: regenerates `content/*.html` from `reference/*.html` (saved copies of the real pages)
  and the example source files. Run `node scripts/gen-docs.mjs` after editing the example code.

The copied stylesheet, fonts and logos under `public/` belong to AssemblyAI: for local preview only.
