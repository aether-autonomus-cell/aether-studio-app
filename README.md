# Aether Studio

Phone remote for a motion-comic studio. The chapter is cut in the browser. Painting and the MP4 run on Gemini (server env) or an open-source worker. The shared file is job packet v2 ([docs/job-packet-v2.md](docs/job-packet-v2.md)).

Chapters stay on the phone (`localStorage`). The worker token stays in the tab (`sessionStorage`). Neither belongs in Git or in Vercel.

## Deploy: GitHub → Vercel

1. Create an empty GitHub repository. Do not commit anything in [.gitignore](.gitignore): `node_modules/`, `.vercel/`, `.grok/`, `artifacts/`, `attachments/`, `.env`, keystores, or APKs.
2. Push this project to that repository.
3. In Vercel, choose **Add New… → Project** and import the GitHub repository.
4. Leave the install command as it is in `vercel.json` (`npm install --omit=dev`). Build command: `npm run build`. Do not set a custom output directory. The Vite config already emits the Vercel/Nitro output.
5. Add the environment variables below, then deploy.

The live site is the installable page (manifest, icons, service worker). See [docs/APK.md](docs/APK.md) if you later want an Android package. No APK is in this repository.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Use Production and Preview. Do not prefix a secret with `VITE_` — that copies it into the browser bundle.

| Name | Where | Required? | What it is |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Optional server fallback. Settings also accepts a key and stores it in this browser's `localStorage`. Never commit a key. | No. Direct, paint, and Gemini voice use the key from Settings first. | Key from [Google AI Studio](https://aistudio.google.com/apikey). |
| `DATABASE_URL` | Server only, if you later add your own SQL migrations at `migrations/*.sql`. | No. | This studio does not store chapters in a database. `npm run build` skips migrate when this is unset. The auth SQL under `migrations/auth/` is not applied. |
| Worker URL | Not an env var. Typed in **Settings** on the phone. | Only for Live worker mode. | Public `https://…` origin of your worker. Private hosts stay blocked. |
| Worker token | Not an env var. Typed in **Settings**. Header `X-Aether-Token` only. | Only for Live worker mode. | Stays in `sessionStorage`. It is not written into `job.json` or this README. |

Do **not** set `XAI_API_KEY` for this app. Grok generate calls are off (`xaiEnabled` is false).

Platform hosts may inject their own `VITE_AUTH_ENABLED`, `BETTER_AUTH_*`, or `GROK_*` values. This studio does not ask visitors to sign in. Leave auth off unless you are deliberately adding accounts.

## YouTube

The YouTube tab is a preview card: title, description, tags, and privacy (public, unlisted, or private). It does not sign in and it does not upload. Privacy is not part of job packet v2.
