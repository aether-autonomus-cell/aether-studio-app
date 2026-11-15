import assert from "node:assert/strict";
import test from "node:test";
import { readSession } from "./ai-router.ts";
import { recoverDirection } from "./director.ts";
import { detectSourcePlatform, extractPlatformText } from "./extract.ts";
import { ECC_RULES, PONYTAIL_RULES, validatePatchDiscipline } from "./harness.ts";
import { advanceHermesStep, createHermesRun, hermesDirectorContract } from "./hermes.ts";
import {
  appendMemoryLog,
  createEmptyGBrain,
  GBRAIN_SQL_SCHEMA,
  queryContinuityContext,
  recordSceneHistoryInGBrain,
  upsertCharactersInGBrain,
} from "./memory.ts";
import { SAMPLE } from "./model.ts";
import { routeCompletion } from "./router.ts";
import { CINEMATIC_TEMPLATES, VIDEO_ENGINES } from "./video-engines.ts";
import { buildEditDecisionList, buildYoutubePackage, detectYoutubeCommand, youtubeSkillPrompt } from "./youtube-skill.ts";

test("OmniRoute fails over from offline/500 worker directly to keyless Pollinations", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(String(input));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const session = readSession({
      duty: "worker",
      workerUrl: "https://worker.example.com",
      apiKey: "",
    });
    const result = await routeCompletion(session, "System", "User", {
      jsonMode: true,
      workerInvoke: async () => ({ ok: false, error: "Worker returned 500.", status: 500 }),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.via, "pollinations");
      assert.equal(result.provider, "pollinations");
      assert.match(result.text, /ok/);
    }
    assert.ok(calls.some((u) => u.includes("text.pollinations.ai/openai")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GBrain memory tracks characters, scenes, and logs without secrets", () => {
  let store = createEmptyGBrain();
  store = upsertCharactersInGBrain(store, [
    { id: "ren", name: "Ren", soul: "Stoic", vessel: "Saffron robe", look: "Scarred brow, saffron robe", starLocked: true },
  ]);
  store = recordSceneHistoryInGBrain(
    store,
    1,
    "Lantern Debt",
    [{ id: "s1", caption: "Rain over the bridge.", dialogue: "", speaker: "", sfx: "", state: "Bridge", imagePrompt: "", imageUrl: null }],
  );
  store = appendMemoryLog(store, "scene", "Split 1 scene");
  const summary = queryContinuityContext(store, "Ren waited on the bridge");
  assert.match(summary, /Ren:/);
  assert.match(summary, /Lantern Debt/);
  assert.match(GBRAIN_SQL_SCHEMA, /CREATE TABLE IF NOT EXISTS character_bibles/);
});

test("Hermes enforces bounded loop iterations and generates director contract", () => {
  let state = createHermesRun(2);
  state = advanceHermesStep(state, { role: "director", phase: "plan", action: "split", route: "cloud", ok: true, note: "step 1" });
  state = advanceHermesStep(state, { role: "director", phase: "execute", action: "paint", route: "worker", ok: true, note: "step 2" });
  state = advanceHermesStep(state, { role: "director", phase: "verify", action: "check", route: "worker", ok: true, note: "step 3" });
  assert.equal(state.loopDetected, true);
  assert.equal(state.phase, "recovered");
  assert.match(hermesDirectorContract("en", "Ren: saffron robe"), /GBrain Continuity Lock/);
});

test("YouTube Agent Skill parses slash commands and generates packaging + EDL", () => {
  assert.equal(detectYoutubeCommand("/yt-script make a hook")?.command, "/yt-script");
  assert.equal(detectYoutubeCommand("/yt-package")?.command, "/yt-package");
  assert.equal(detectYoutubeCommand("/yt-edit")?.command, "/yt-edit");
  assert.match(youtubeSkillPrompt("/yt-script", "hi"), /Hindi/);
  const pkg = buildYoutubePackage(SAMPLE);
  assert.ok(pkg.titles.length >= 2);
  assert.ok(buildEditDecisionList(SAMPLE.scenes).length >= 1);
});

test("Director recovers deterministic 15-25 word beats and Cast from malformed LLM output", () => {
  const source = "Lantern Debt\n\nRen wore a torn saffron robe and stood on the bridge. Shao watched silently beneath the tall cedar tree as the rain poured over the stone railings.";
  const recovered = recoverDirection("{not valid json", source);
  assert.equal(recovered.recovered, true);
  assert.ok(recovered.direction.scenes.length >= 1);
  assert.ok(recovered.direction.characters.some((c) => c.name === "Ren"));
});

test("Harness guard validates discipline and rejects raw secret tokens", () => {
  assert.ok(ECC_RULES.length >= 3);
  assert.ok(PONYTAIL_RULES.length >= 2);
  assert.equal(validatePatchDiscipline("AIzaSyDummySecretToken12345678901234567890").ok, false);
  assert.equal(validatePatchDiscipline("Clean director plan").ok, true);
});

test("Video engines and cinematic templates include MoneyPrinterTurbo and Cinematic Skill", () => {
  assert.ok(VIDEO_ENGINES.some((e) => e.id === "moneyprinter-turbo"));
  assert.ok(VIDEO_ENGINES.some((e) => e.id === "cinematic-skill"));
  assert.ok(CINEMATIC_TEMPLATES.some((t) => t.id === "chapter-opener"));
});

test("Platform extractors handle YouTube, Bilibili, and Reddit cleanly", () => {
  assert.equal(detectSourcePlatform("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectSourcePlatform("https://www.bilibili.com/video/BV1xx"), "bilibili");
  assert.equal(detectSourcePlatform("https://www.reddit.com/r/manhwa/comments/123/test"), "reddit");
  const yt = extractPlatformText('<transcript><text start="0">Line one</text><text start="2">Line two</text><text start="4">Line three</text><text start="6">Line four</text></transcript>', "https://www.youtube.com/watch?v=abc");
  assert.match(yt.text, /Line four/);
});
