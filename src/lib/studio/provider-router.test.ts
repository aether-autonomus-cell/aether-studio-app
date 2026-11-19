import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  buildDeterministic21Hooks,
  buildDeterministicPackages,
  extractVerticalShortsArc,
  render2DThumbnailSvg,
} from "./hooks.ts";
import {
  compileStoryDeterministic,
  completeStructured,
  getCircuitState,
  resetCircuitBreaker,
} from "./provider-router.ts";
import { createDefaultProject, sceneGraphV1Schema } from "./schema.ts";

test("compileStoryDeterministic builds valid dual-language SceneGraphV1 offline", () => {
  const graph = compileStoryDeterministic({
    titleEn: "Signal in Jaipur",
    titleHi: "जयपुर का संकेत",
    storyText:
      "First sentence opens the midnight signal above Jaipur with a silent red countdown ticking on the station clock.\n\nSecond beat reveals the encrypted star map hidden beneath the brass instrument panel before dawn.\n\nThird beat resolves the countdown and launches the twin courier signal across the desert ridge.",
    mode: "manhwa-anime",
    aspectRatio: "9:16",
    visualMode: "pure-2d",
    styleId: "midnight-cyan@1",
    languages: ["hi-IN", "en-US"],
  });
  const parsed = sceneGraphV1Schema.safeParse(graph);
  assert.equal(parsed.success, true);
  assert.equal(graph.project.scenes.length, 3);
  assert.equal(graph.project.scenes[0].template_id, "hook-card@1");
  assert.equal(graph.project.scenes[2].template_id, "recap-payoff@1");
});

test("completeStructured falls back deterministically and trips circuit breaker after 3 failures", async () => {
  resetCircuitBreaker();
  const failingFetch: typeof fetch = async () => {
    throw new Error("Simulated offline network");
  };

  for (let i = 0; i < 3; i += 1) {
    const res = await completeStructured({
      task: "test",
      schema: z.object({ ok: z.boolean() }),
      systemPrompt: "sys",
      userPrompt: "usr",
      localFallback: () => ({ ok: true }),
      fetchImpl: failingFetch,
    });
    assert.equal(res.route, "local-deterministic");
    assert.deepEqual(res.data, { ok: true });
  }

  const breaker = getCircuitState();
  assert.equal(breaker.open, true);
  assert.equal(breaker.failures, 3);
  resetCircuitBreaker();
});

test("completeStructured honors Tier 2 Colab LLM override JSON when valid", async () => {
  resetCircuitBreaker();
  const res = await completeStructured({
    task: "test",
    schema: z.object({ count: z.number() }),
    systemPrompt: "sys",
    userPrompt: "usr",
    localFallback: () => ({ count: 0 }),
    colabOverrideJson: '```json\n{"count": 7}\n```',
    disableRemote: true,
  });
  assert.equal(res.route, "colab-llm");
  assert.deepEqual(res.data, { count: 7 });
});

test("YouTube skill tools generate 21 hooks (5 shortlisted), 3 2D thumbnails, and 9:16 shorts arc", () => {
  const hooks = buildDeterministic21Hooks("the midnight clock");
  assert.equal(hooks.hooks.length, 21);
  assert.equal(hooks.top5Ids.length, 5);

  const job = createDefaultProject();
  const pkg = buildDeterministicPackages(job);
  assert.equal(pkg.concepts.length, 3);

  const svg = render2DThumbnailSvg(
    pkg.concepts[0].thumbnail_headline_en,
    pkg.concepts[0].thumbnail_headline_hi,
    job.project.style_id,
  );
  assert.match(svg, /<svg/);
  assert.match(svg, /AETHER 2D/);

  const shorts = extractVerticalShortsArc(job);
  assert.equal(shorts.aspect_ratio, "9:16");
  assert.ok(shorts.estimated_duration_sec >= 30 && shorts.estimated_duration_sec <= 60);
});
