import test from "node:test";
import assert from "node:assert/strict";
import { dispatchSkillTool, evaluateSkillRegistry, loadTaskInstructions } from "./index.ts";

test("skill registry reports accurate license & runtime status with zero broken files", () => {
  const report = evaluateSkillRegistry({ verifyHashes: true, workerActive: false });
  assert.equal(report.summary.total, 9);
  assert.equal(report.summary.broken, 0);
  assert.equal(report.summary.blocked_licence, 1);
  assert.equal(report.summary.unavailable_incompatible, 1);
  assert.equal(report.summary.dev_only_not_production, 1);
  assert.equal(report.summary.ready, 2);
  assert.equal(report.summary.waiting_worker, 4);

  const lemoDocs = report.skills.find((s) => s.skill_id === "lemo.style_docs");
  assert.equal(lemoDocs?.status, "blocked_licence");
  assert.equal(lemoDocs?.spdx_license, "CC-BY-NC-4.0");
});

test("task instruction loader loads only approved MIT/Apache instructions and excludes CC-BY-NC-4.0", () => {
  const storyChunks = loadTaskInstructions("story");
  assert.ok(storyChunks.length >= 3);
  assert.ok(storyChunks.every((c) => c.skill_id !== "lemo.style_docs"));
  assert.ok(storyChunks.every((c) => !c.spdx_license.includes("NC")));
});

test("dispatcher blocks CC-BY-NC-4.0 tool calls and validates schemas", () => {
  const blocked = dispatchSkillTool("lemo_style_docs_lookup", { query: "anime" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.trace.status, "blocked_licence");

  const invalid = dispatchSkillTool("youtube_score_hooks", { hook: "" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.trace.status, "rejected");
});

test("dispatcher executes real vendored YouTube & Cinematic Python skill tools", () => {
  const hookRes = dispatchSkillTool("youtube_score_hooks", {
    hook: "You lost 3 hours because nobody told you why the river stopped at midnight?",
  });
  assert.equal(hookRes.ok, true, hookRes.error ?? undefined);
  assert.equal(hookRes.trace.status, "ok");

  const titleRes = dispatchSkillTool("youtube_lint_title", {
    title: "The Forgotten Stepwell of 1903",
    thumbnail_text: "STEPWELL",
  });
  assert.equal(titleRes.ok, true, titleRes.error ?? undefined);

  const deadairRes = dispatchSkillTool("youtube_detect_deadair", {
    srt_content: "1\n00:00:00,000 --> 00:00:02,000\nFirst line.\n\n2\n00:00:04,500 --> 00:00:06,500\nSecond line.\n",
    floor_sec: 0.45,
  });
  assert.equal(deadairRes.ok, true, deadairRes.error ?? undefined);
  assert.ok((deadairRes.data as { cuts: unknown[] }).cuts.length >= 1);

  const beatsRes = dispatchSkillTool("cinematic_lint_beats", {
    title: "Stepwell Echoes",
    lines: [
      {
        id: "L1",
        text: "Rain taps softly on old stone steps.",
        spoken: "Rain taps softly on old stone steps.",
        hero: "Meera on top step",
        typed: "",
        gap_after: 0.45,
      },
    ],
  });
  assert.equal(beatsRes.ok, true, beatsRes.error ?? undefined);
  assert.ok((beatsRes.data as { beats_markdown: string }).beats_markdown.includes("Stepwell Echoes"));
});
