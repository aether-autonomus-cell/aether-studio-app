# Handoff — Aether Studio

Phone remote for a motion-comic studio. The chapter is cut here. Painting, voice, and the MP4 happen on Gemini (server env) or an open-source worker. The shared contract is job packet v2.

## What landed

| Task | State |
| --- | --- |
| A0 | Done. [docs/job-packet-v2.md](job-packet-v2.md) and [src/lib/studio/schema.ts](../src/lib/studio/schema.ts). `chapters[]`, `language` `hi`/`en`, male `voice`, `scenes[]` with `tiles[]` (`prompt`, `negative`, `characters`, `vessel_id`), `bubble` `{ speaker, text }`, `sfx`. |
| A1 | Done. Settings: worker URL + token in `sessionStorage` only (not the chapter file). Test connection is `GET {origin}/api/v1/health` with `X-Aether-Token`. Mode: Live worker / Job packet. Private hosts stay blocked. |
| A2 | Done. Director is Gemini or Open-source worker. Keys are read only from server env (`GEMINI_API_KEY`). The screen shows configured / not configured and the model names from [src/lib/studio/config.ts](../src/lib/studio/config.ts). `xaiEnabled` is `false`. No xAI / Grok generate calls. |
| A3 | Done. Chapter link accepts `{n}` or a start–end range that replaces the last number. Each chapter is fetched on its own (max 40 a pull). Page text is not cut at 8,000 characters. Long chapters are chunked at 8,000 for the director so the ending is kept. The old 6-scene cap is gone, including the director's old 40-scene slice. |
| A4 | Done. Bay downloads `job.json` and, in Live worker mode, POSTs the same v2 packet to `{origin}/api/v1/jobs`. The token is a header, never a field in the file. |
| A5 | Done. After a send, Bay polls `GET /api/v1/jobs/{id}` every 2.5s. Progress, label, and error come from the worker. Retry posts the same packet again. Download MP4 pulls the worker file through `/api/studio/mp4` (token stays off the packet). |
| A6 | Done. Strip bubbles sit under the art, wrap, and are not clipped by the card. A leading `Name:` is stripped so the speaker chip (REN) is not drawn twice on the line. Hit words sit on the picture, not on the bubble. A blank panel says only "Not painted" — no prompt, caption, or state inside the frame. The saved strip PNG uses the same rules. |
| A7 | Done. **YouTube** is its own tab. The card edits title (100), description (5000), tags, and privacy (`public` / `unlisted` / `private`, default private). Thumbnail is the first painted panel. Copy card includes the privacy line. If the clipboard API is blocked (common inside an embedded preview), copy falls back to a hidden text selection. There is no YouTube sign-in and no upload. Bay still copies and sends the job packet; it no longer hosts the card. |
| A8 | Done. PWA files: `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`, `public/sw.js`. The head links `/manifest.webmanifest` first (the platform link `/__grok/manifest.webmanifest` stays). A dismissible **Add to Home screen** hint is on the studio screens. The service worker registers only for a top-level production visit. |
| A9 | Done. [README.md](../README.md): GitHub → Vercel, and which variable goes where. `GEMINI_API_KEY` is the only studio secret. Worker URL and token are not env vars. |
| A10 | Done as steps only. [docs/APK.md](APK.md). **No APK was built.** |
| A11 | Done. [.gitignore](../.gitignore) ignores `.vercel`, `.grok`, `artifacts`, `attachments`, `node_modules`, env files, keystores, and `*.apk`. Secret scan of the source tree found no API key. |

## Schema

Version literal `2`. Source of truth: `jobPacketV2Schema` in `src/lib/studio/schema.ts`. A copy that fails the schema is not sent and is not written as `job.json`.

`seo` on the packet is still `{ title, description, tags }`. `privacy` lives on the in-memory project and in `localStorage` only. `jobPacket()` strips it before validate. A test covers that.

Voices: `hi-IN-MadhurNeural`, `en-IN-PrabhatNeural`. Devanagari in the chapter selects `hi`. No female fallback.

## Checked again (19 Oct 2026)

The zip already contained A0–A11. This pass did not replace the studio. It restored that tree, then re-checked it.

- Studio tests: 19 passed (packet v2, privacy stripped, range, worker, voice, strip speaker).
- `npm run typecheck` and `npm run build` passed. TanStack Start is 1.168.60.
- Dev preview: Strip, YouTube, and Bay render on a phone-sized screen. YouTube shows title, description, tags, privacy (default private; unlisted selects), "Not uploaded", and no sign-in. Copy card succeeded with the fallback. Bay says the packet does not include privacy and does not sign into YouTube.
- PWA files answer 200: `/manifest.webmanifest`, icons, `/sw.js`. Dev serves the manifest as `application/manifest+json`. The deploy route sets that same type. A local production file server may still label it `application/octet-stream`; that is the preview process, not the Vercel route. The Add to Home screen hint is on the studio screens. The worker still registers only on a top-level production visit.
- Secret scan of source, docs, and public text: no API key. No `.env`. No APK file. `.gitignore` still drops `.vercel`, `.grok`, `artifacts`, `attachments`, and `node_modules`.

## GitHub package (19 Oct 2026)

The uploaded snapshot was about 35MB. Almost all of that was files the app does not need, and that [.gitignore](../.gitignore) already drops. A source zip of this tree is well under GitHub's 25MB upload limit.

Left out of the package:

| Removed | Approx. size | Why |
| --- | --- | --- |
| `attachments/grok-workspace.zip` | 30MB | A nested copy of an older workspace. Not source. |
| Other files under `attachments/` | ~0.4MB | Reference images and the blueprint PDF. Not the app. |
| `.vercel/` | ~3MB | Production build output. Vercel rebuilds it from the source. |
| `screenshots/` | ~1.5MB | QA pictures from earlier checks. |
| `.grok/` | ~0.8MB | Sandbox platform files. Not part of the studio. |
| `node_modules/` | — | Installed by `npm install` on Vercel. Was not required in the source zip. |

Nothing in the studio source was deleted. Job packet v2, the phone UI, sample panels, PWA icons, and the docs are still in the package. No API key, worker token, `.env`, keystore, or APK is in it.

## What is left

- YouTube OAuth and a real upload are not started. The tab is a preview card on purpose.
- No APK, no Bubblewrap run, no Android SDK build. Follow docs/APK.md on a machine that has the SDK. Do not say an APK exists until the file does.
- Point Settings at a real worker and use Test connection. This environment has no worker, so live send / poll / MP4 were checked against the client and the parser, not a GPU box.
- Set `GEMINI_API_KEY` in the server environment to turn Gemini from "not configured" to "configured". Do not put the key in the repo, the UI, or a zip.
- On-device male voice is the fallback when the worker has no track. Gemini does not speak in this studio.
- Paint still asks for at most four pictures per tap, so an image call cannot run away. The cut itself is not capped at four or six scenes.
- A single "Read it" call sends at most 700 characters to the worker voice route. A longer narration needs another pass or the factory cell.
- The service worker does not run in `vite dev` or inside an embedded preview frame. Confirm it on the deployed HTTPS origin (or a production preview opened directly).

## Known limits

- Paywalled or login pages return `SOURCE_ACCESS_DENIED`. Paste the text. Nothing tries to get around the lock.
- One failed status poll marks the job as error and stops polling. Retry sends the packet again; it does not resume the old id.
- The factory cell in Bay still accepts a legacy packet with top-level `scenes`. New files are always version 2.
- Saved chapters in `localStorage` drop data-URL paintings. Sample panels under `/panels/` are kept.
- Tag text is committed on blur or Copy card. A trailing comma is removed at that moment. YouTube sign-in is still absent, so the card cannot be published from here.
- Copy uses the clipboard API first. Inside a frame that blocks that API, it falls back to selecting the text. If both fail, the screen says the card was not copied.
- `public/sw.js` caches the manifest, icons, and favicon only. Navigations stay on the network, so a failed network does not open an offline copy of the studio.
- Browsers that see two manifest links use the first (`/manifest.webmanifest`). The platform manifest remains in the head for its own install chrome. Deploy sends `Content-Type: application/manifest+json` for `/manifest.webmanifest`.

## No secrets

No API key, worker token, keystore, or `.env` is in this tree. The worker token lives in the browser tab only. `.gitignore` keeps `.vercel`, `.grok`, `artifacts`, `attachments`, and `node_modules` out of a source zip.
