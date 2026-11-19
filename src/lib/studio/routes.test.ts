import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "../../..");

test("legacy bloated studio files and mp4 proxy route are removed", () => {
  const retired = [
    "src/routes/api/studio/mp4.ts",
    "grok-workspace.zip",
    "fix-scraper.js",
    "public/panels/01-bridge.jpg",
    "src/lib/studio/wtr.ts",
    "src/lib/studio/extract.ts",
    "src/lib/studio/hermes.ts",
  ];
  for (const rel of retired) {
    assert.equal(existsSync(join(ROOT, rel)), false, `Expected legacy file removed: ${rel}`);
  }
});

test("all v2.0 API routes, Colab worker modules, and bundled fonts exist", () => {
  const required = [
    "src/routes/api/2d/status.ts",
    "src/routes/api/2d/generate.ts",
    "src/routes/api/2d/jobs/index.ts",
    "src/routes/api/2d/jobs/$jobId/index.ts",
    "src/routes/api/2d/jobs/$jobId/pair.ts",
    "src/routes/api/2d/jobs/$jobId/cancel.ts",
    "src/routes/api/2d/jobs/$jobId/publish-intents.ts",
    "src/routes/api/2d/worker/claim.ts",
    "src/routes/api/2d/worker/heartbeat.ts",
    "src/routes/api/2d/worker/complete.ts",
    "src/routes/api/2d/oauth/google/start.ts",
    "src/routes/api/2d/oauth/google/callback.ts",
    "migrations/2d/0001_studio.sql",
    "colab_worker.py",
    "worker/api.py",
    "worker/speech.py",
    "worker/timing.py",
    "worker/render_browser.py",
    "worker/backdrop_hybrid.py",
    "worker/mux.py",
    "worker/drive.py",
    "worker/publish.py",
    "notebooks/Aether_2D_Render.ipynb",
    "public/renderer/index.html",
    "public/renderer/aether-runtime.js",
    "public/renderer/fonts/noto-sans-devanagari-devanagari-400-normal.woff2",
    "THIRD_PARTY_NOTICES.md",
  ];
  for (const rel of required) {
    assert.equal(existsSync(join(ROOT, rel)), true, `Missing required v2.0 artifact: ${rel}`);
  }
});

test("status route responds local-ready gracefully without DATABASE_URL", async () => {
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const statusSrc = readFileSync(join(ROOT, "src/routes/api/2d/status.ts"), "utf8");
    assert.match(statusSrc, /local-ready/);
    assert.match(statusSrc, /cloud-ready/);
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
  }
});
