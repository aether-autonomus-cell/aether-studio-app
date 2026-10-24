import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FACTORY_CELL } from "./factory-cell.ts";

const app = readFileSync(new URL("../../components/studio/app.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");

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
  assert.match(api, /\/api\/v1\/llm/);
  assert.match(api, /API Verified & Connected — OK/);
  assert.match(api, /\/api\/v1\/preview\.mp4/);
  assert.match(api, /\/api\/v1\/youtube-upload/);
});

test("factory cell exposes the gpu worker the app calls", () => {
  for (const path of [
    "/api/v1/health",
    "/api/v1/llm",
    "/api/v1/jobs",
    "/api/v1/preview.mp4",
    "/api/v1/youtube-upload",
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
  ]) {
    assert.equal(FACTORY_CELL.includes(path), true, path);
  }
  assert.equal(FACTORY_CELL.includes("tensor_split=None"), false);
  assert.equal(FACTORY_CELL.includes("Generating images"), false);
});
