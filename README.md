# Aether Studio v2.0

**Pure 2D Code-to-Video & Dual-Language Story Studio** (Hindi `hi-IN-MadhurNeural` + English `en-US-ChristopherNeural`) for Vercel + Interactive Google Colab.

## Architecture Highlights

- **Zero-Setup Day-1 Default (Mode A)**: Projects, revisions, and render history persist locally in Browser IndexedDB. Export `aether_job.json` and run directly in Colab with zero database or server secrets required.
- **Optional Cloud Queue & OAuth (Mode B)**: Automatically activates when `DATABASE_URL` and Google OAuth credentials are configured on Vercel.
- **4-Tab Mobile-First Shell**:
  1. **Story**: Up to 30,000-character story input, paired Hindi/English scene-locked narration, keyless AI failover (`Pollinations` → `Colab LLM` → `Local Deterministic`), 21-Hook Generator, Title + 2D Coded Thumbnail Packager, and 9:16 Shorts Extractor.
  2. **2D Code & Live Preview**: Structured `SceneGraphV1` editor + Isolated Custom 2D Code Mode (`Canvas 2D`, `SVG`, deterministic `p5.js` `noLoop()`) rendered inside a strict-CSP `<iframe sandbox="allow-scripts">` over a nonce-validated `MessageChannel` with bundled Latin + Devanagari fonts.
  3. **Colab Render**: Compact 20-line Colab bootstrapper (`colab_worker.py` + `worker/*`), cumulative 48 kHz PCM frame timing (zero audio drift), isolated Playwright PNG-to-FFmpeg pipe, segmented rendering up to 600s / 120 scenes, sidechain BGM ducking, and Google Drive auto-save.
  4. **Direct Publish**: Dual-channel Hindi + English YouTube metadata matrix, SHA-256 bound Publish Manifest, resumable Colab YouTube uploader with Drive checkpoints, and direct Google Drive delivery.

## Local Development & Verification

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
python3 -m py_compile colab_worker.py worker/*.py
```
