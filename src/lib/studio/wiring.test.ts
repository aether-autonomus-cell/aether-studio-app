import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLAB_WORKER_RAW_URLS, FACTORY_CELL } from "./factory-cell.ts";
import { chooseVoice } from "./export.ts";

const app = readFileSync(new URL("../../components/studio/app.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../../colab_worker.py", import.meta.url), "utf8");

test("secrets are never written to storage", () => {
  const sources = [app, api, readFileSync(new URL("./export.ts", import.meta.url), "utf8")];
  for (const source of sources) {
    assert.equal(/localStorage\.setItem|sessionStorage\.setItem|document\.cookie\s*=/.test(source), false);
  }
  assert.match(app, /wipeLegacySecrets/);
  assert.match(app, /useState\(""\)/);
});

test("settings and youtube buttons call live network functions", () => {
  assert.match(app, /verifyCloud\(/);
  assert.match(app, /testWorker\(/);
  assert.match(app, /directChapter\(/);
  assert.match(app, /fetch\("\/api\/studio\/mp4"/);
  assert.match(app, /uploadYoutube\(/);
  assert.match(app, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(app, /youtube\.upload/);
  assert.match(api, /export async function callActiveAI/);
  assert.match(api, /API Verified & Connected — OK/);
  assert.match(api, /\/api\/v1\/preview\.mp4/);
  assert.match(api, /\/api\/v1\/youtube-upload/);
});

test("factory cell is a compact GitHub bootstrapper and colab_worker.py exposes full GPU worker endpoints", () => {
  const lines = FACTORY_CELL.trim().split("\n");
  assert.ok(lines.length <= 25, `Expected compact bootstrapper, got ${lines.length} lines`);
  assert.match(FACTORY_CELL, /colab_worker\.py/);
  assert.ok(COLAB_WORKER_RAW_URLS.length >= 1);

  for (const path of [
    "/api/v1/health",
    "/api/v1/llm",
    "/api/v1/jobs",
    "/api/v1/preview.mp4",
    "/api/v1/youtube-upload",
    "/api/v1/cinematic",
    "/api/v1/video/produce",
    "/scrape",
    "/api/generate",
    "/extract",
    "/tts",
    "/render",
    '@app.get("/health")',
    "/api/v1/speak",
    "edge_tts",
    "hi-IN-MadhurNeural",
    "en-US-ChristopherNeural",
    "airllm",
    "trycloudflare.com",
    "tensor_split",
    "zoompan",
    "silenceremove",
    "apad=pad_dur=0.12",
    "/api/v1/masters/",
    "text.pollinations.ai/openai",
    "run_moneyprinter_turbo",
    "run_cinematic_skill",
  ]) {
    assert.equal(worker.includes(path), true, path);
  }
  assert.equal(worker.includes("tensor_split=None"), false);
  assert.equal(worker.includes("Generating images"), false);
  assert.match(worker, /GPU painter unavailable/);
});

test("image generation has selectable providers and no Pollinations image URL fallback", () => {
  assert.match(app, /Generate 5x Batch/);
  assert.match(app, /Auto-Fix Failed Panels/);
  assert.match(app, /uploadYoutubeBlob/);
  assert.match(api, /gemini-2\.0-flash-exp-image-generation/);
  assert.match(api, /imagen-3\.0-generate-002/);
  assert.match(api, /FLUX\.1-schnell/);
  assert.match(api, /\/api\/v1\/paint/);
  assert.doesNotMatch(api, /image\.pollinations\.ai/);
});

test("response handling never injects redaction placeholders", () => {
  assert.doesNotMatch(api, /\[redacted\]/i);
});

test("on-device speech prefers requested voices and falls back by language", () => {
  const voices = [
    { name: "Microsoft David", lang: "en-US" },
    { name: "Microsoft Christopher Online (Natural)", lang: "en-US" },
    { name: "Microsoft Madhur Online (Natural)", lang: "hi-IN" },
  ] as SpeechSynthesisVoice[];
  assert.equal(chooseVoice(voices, "Good evening.")?.name, "Microsoft Christopher Online (Natural)");
  assert.equal(chooseVoice(voices, "नमस्ते।")?.name, "Microsoft Madhur Online (Natural)");
  assert.equal(chooseVoice([voices[0]!], "Good evening.")?.name, "Microsoft David");
  assert.equal(chooseVoice([{ name: "System English", lang: "en-US" } as SpeechSynthesisVoice], "Good evening.")?.name, "System English");
  assert.equal(chooseVoice([{ name: "System Hindi", lang: "hi-IN" } as SpeechSynthesisVoice], "नमस्ते।")?.name, "System Hindi");
});
