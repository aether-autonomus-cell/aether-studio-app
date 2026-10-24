import assert from "node:assert/strict";
import test from "node:test";
import { cloudRequest, imageVia, readSession, shouldFailover, textFromModel, textVia } from "./ai-router.ts";

const blank = {
  provider: "zai" as const,
  model: "glm-4-flash",
  apiKey: "",
  customBaseUrl: "",
  workerUrl: "",
  workerToken: "",
  localModel: "gguf" as const,
  language: "en" as const,
  duty: "split" as const,
};

test("a missing key does not call the cloud", () => {
  assert.equal(cloudRequest(blank), null);
});

test("Z.ai, OpenRouter, GitHub, and Gemini build live endpoints", () => {
  const zai = cloudRequest({ ...blank, apiKey: "sk-zai", model: "glm-5.2" });
  assert.equal(zai?.kind, "openai");
  assert.match(zai && zai.kind === "openai" ? zai.url : "", /open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions/);
  const router = cloudRequest({ ...blank, provider: "openrouter", apiKey: "sk-or", model: "z-ai/glm-5.2:free" });
  assert.match(router && router.kind === "openai" ? router.url : "", /openrouter\.ai\/api\/v1/);
  const github = cloudRequest({ ...blank, provider: "github", apiKey: "github_pat_test", model: "gpt-4o" });
  assert.match(github && github.kind === "openai" ? github.url : "", /models\.inference\.ai\.azure\.com/);
  const gemini = cloudRequest({ ...blank, provider: "gemini", apiKey: "AIza", model: "gemini-2.5-flash" });
  assert.equal(gemini?.kind, "gemini");
  assert.match(gemini && gemini.kind === "gemini" ? gemini.url : "", /gemini-2\.5-flash:generateContent/);
});

test("rate limit, quota, and any HTTP error fail over to local", () => {
  assert.equal(shouldFailover(429, ""), true);
  assert.equal(shouldFailover(200, "quota exhausted"), true);
  assert.equal(shouldFailover(500, "boom"), true);
  assert.equal(shouldFailover(0, "timeout"), true);
  assert.equal(shouldFailover(200, "OK"), false);
});

test("session reading keeps a worker-only call off the cloud key", () => {
  const session = readSession({ provider: "worker", apiKey: "should-drop", workerUrl: "https://example.com", language: "hi" });
  assert.equal(session.apiKey, "");
  assert.equal(session.language, "hi");
  assert.equal(session.localModel, "gguf");
});

test("local model text is read from OpenAI-style or plain JSON", () => {
  assert.equal(textFromModel({ choices: [{ message: { content: "{\"title\":\"Gate\"}" } }] }), "{\"title\":\"Gate\"}");
  assert.equal(textFromModel({ text: "hook" }), "hook");
});

test("split mode lets the key write and the worker paint", () => {
  assert.equal(textVia("split", true, true), "key");
  assert.equal(imageVia("split", true), "worker");
  assert.equal(textVia("worker", true, true), "worker");
  assert.equal(imageVia("key", true), "fallback");
  assert.equal(textVia("split", false, true), "worker");
  const session = readSession({ duty: "worker", apiKey: "sk", workerUrl: "https://example.com" });
  assert.equal(session.duty, "worker");
});
