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
});

test("a job id is appended and traversal is refused", () => {
  assert.equal(workerEndpoint("https://worker.example.com", "/api/v1/jobs/abc").href, "https://worker.example.com/api/v1/jobs/abc");
  assert.throws(() => workerEndpoint("https://worker.example.com", "/api/v1/../health"), /not valid/);
});
