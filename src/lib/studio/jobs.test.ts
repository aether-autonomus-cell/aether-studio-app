import assert from "node:assert/strict";
import test from "node:test";
import { studioConfig } from "./config.ts";
import { assertJobId, jobResourcePath, parseJobStatus, readJobId } from "./jobs.ts";

test("grok stays disabled and model names live in config", () => {
  assert.equal(studioConfig.xaiEnabled, false);
  assert.equal(studioConfig.geminiModel, "gemini-2.5-flash");
});

test("status json reports real progress, failure, and the mp4", () => {
  const running = parseJobStatus(
    { id: "job_1", status: "processing", progress: { current: 1, total: 4, label: "Painting" } },
    "job_1",
  );
  assert.equal(running.status, "running");
  assert.equal(running.progress, 25);
  assert.equal(running.label, "Painting");

  const done = parseJobStatus(
    { job: { id: "abc", state: "completed", mp4_url: "https://worker.example.com/a.mp4" } },
    "abc",
  );
  assert.equal(done.status, "done");
  assert.equal(done.progress, 100);
  assert.equal(done.mp4Url, "https://worker.example.com/a.mp4");

  const failed = parseJobStatus({ id: "bad", status: "failed", error: "GPU dropped" }, "bad");
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "GPU dropped");
});

test("job ids are read from the accept body and cannot escape the path", () => {
  assert.equal(readJobId(JSON.stringify({ jobId: "abc-1" })), "abc-1");
  assert.equal(jobResourcePath("abc-1", "mp4"), "/api/v1/jobs/abc-1/mp4");
  assert.throws(() => assertJobId("../etc"), /not valid/);
});
