# Third-Party Notices & Open-Source Attribution

Aether Studio v2.0 is a clean-room Pure 2D Code-to-Video & Dual-Language Story Studio built with TypeScript, React 19, TanStack Start, Tailwind CSS, and Python 3.11+.

## Architectural Pattern Attributions

- **HyperFrames** (`heygen-com/hyperframes`) — Licensed under the Apache License, Version 2.0. Architectural inspiration for deterministic explicit frame-index HTML/CSS/SVG/Canvas rendering shared between browser preview and headless Chromium export.
- **Cinematic Skill** (`Moh4696/cinematic-skill`) — MIT License. Architectural inspiration for narration-first audio duration measurement and deterministic motion timing.
- **Lemo-Opuscar** (`lemomo-ai/lemo-opuscar`) — MIT License (code). Architectural inspiration for declarative style manifests, reusable scene templates, and `credits.txt` attribution export bundles. All Aether Studio styles and templates are original first-party implementations.
- **Claude Animation Base** (`JohnHeibel/ClaudeAnimationBase`) — MIT License. Architectural inspiration for deterministic 2D staging via Canvas and `noLoop()` + explicit frame-indexed p5.js compatibility.
- **MoneyPrinterTurbo** (`harry0703/MoneyPrinterTurbo`) — MIT License. Architectural inspiration for zero-key Edge-TTS synthesis, SRT/VTT caption generation, ducked BGM mixing, and FFmpeg MP4 muxing.
- **YouTube Agent Skill** (`Jakeschincariol/youtube-agent-skill`) — MIT License. Architectural inspiration for 21-hook structuring, Title + Thumbnail packaging concepts, and vertical Shorts extraction.
- **OmniRoute** (`diegosouzapw/OmniRoute`) — MIT License. Architectural inspiration for compact ordered keyless failover with bounded timeouts and circuit-breaker recovery (`src/lib/studio/provider-router.ts`).
- **Ponytail** (`DietrichGebert/ponytail`) — MIT License. Engineering discipline for small cohesive modules and strict schema validation.

## Bundled Fonts (SIL Open Font License 1.1)

- **Inter** (`@fontsource/inter`, SIL OFL 1.1) — Bundled under `public/renderer/fonts/`
- **Space Grotesk** (`@fontsource/space-grotesk`, SIL OFL 1.1) — Bundled under `public/renderer/fonts/`
- **Noto Sans Devanagari** (`@fontsource/noto-sans-devanagari`, SIL OFL 1.1) — Bundled under `public/renderer/fonts/`
