import assert from "node:assert/strict";
import test from "node:test";
import { workerEndpoint } from "./worker.ts";

test("health is origin plus /api/v1/health", () => {
  assert.equal(workerEndpoint("https://worker.example.com", "/api/v1/health").href, "https://worker.example.com/api/v1/health");
  assert.equal(
    workerEndpoint("https://worker.example.com/api/v1/health", "/api/v1/jobs").href,
    "https://worker.example.com/api/v1/jobs",
  );
});

test("a mounted prefix is kept", () => {
  assert.equal(workerEndpoint("https://example.com/aether/", "/api/v1/health").href, "https://example.com/aether/api/v1/health");
  assert.equal(workerEndpoint("https://example.com/aether/api/v1/health///", "/api/v1/jobs").href, "https://example.com/aether/api/v1/jobs");
});

test("the Colab factory routes resolve beneath a worker URL with trailing slashes", () => {
  const paths = [
    "/api/v1/health",
    "/api/v1/llm",
    "/api/v1/paint",
    "/api/v1/speak",
    "/api/v1/jobs",
    "/api/v1/fetch",
    "/api/v1/youtube-upload",
  ];
  for (const path of paths) {
    assert.equal(workerEndpoint("https://worker.example.com///", path).href, `https://worker.example.com${path}`);
  }
});

test("compatibility routes build clean worker URLs", () => {
  for (const path of ["/api/generate", "/extract", "/tts", "/render", "/health"]) {
    assert.equal(workerEndpoint("https://worker.example.com", path).href, `https://worker.example.com${path}`);
  }
  assert.equal(workerEndpoint("https://worker.example.com/health", "/api/generate").href, "https://worker.example.com/api/generate");
});

test("a job id is appended and traversal is refused", () => {
  assert.equal(workerEndpoint("https://worker.example.com", "/api/v1/jobs/abc").href, "https://worker.example.com/api/v1/jobs/abc");
  assert.throws(() => workerEndpoint("https://worker.example.com", "/api/v1/../health"), /not valid/);
});
