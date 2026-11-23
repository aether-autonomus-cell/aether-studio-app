import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ZERO_SPEND_POLICY, type KrStoryRevision } from "../contracts/schemas.ts";
import {
  applyStoryPatchToBible,
  buildDefaultStoryBible,
  evaluateDirectorRoute,
  gatherDirectorGuidance,
  proposeStoryPatch,
  rebaseStoryPatch,
  sha256Json,
} from "./index.ts";

test("KathaRiftDirectorRouter enforces strict zero-spend and pauses on free-tier quota exhaustion", () => {
  const ok = evaluateDirectorRoute("deterministic-local-director", DEFAULT_ZERO_SPEND_POLICY);
  assert.equal(ok.ok, true);
  assert.equal(ok.status, "ok");

  const paid = evaluateDirectorRoute("openai-gpt4o-paid", DEFAULT_ZERO_SPEND_POLICY);
  assert.equal(paid.ok, false);
  assert.equal(paid.status, "rejected_paid_route");

  const paused = evaluateDirectorRoute("google-gemini-free-tier", DEFAULT_ZERO_SPEND_POLICY, {
    simulatedQuotaExhausted: true,
  });
  assert.equal(paused.ok, false);
  assert.equal(paused.status, "quota_paused");
});

test("Story patch respects locked canon, applies cleanly, and rebases non-conflicting patches", () => {
  const bible = buildDefaultStoryBible("proj_1");
  const rev1: KrStoryRevision = {
    revision_id: "srev_1",
    project_id: "proj_1",
    version: 1,
    parent_revision_id: null,
    summary: "Initial",
    content_sha256: sha256Json(bible),
    bible,
    created_at: "2026-11-22T16:00:00Z",
  };

  const { patch } = proposeStoryPatch({
    revision: rev1,
    instruction: "Make the scene feel drenched in rain",
  });
  assert.ok(patch.operations.length >= 1);
  // Scene 1 is locked_canon=true, so patch targets sc_02
  assert.equal(patch.operations[0].target_id, "sc_02");

  const updatedBible = applyStoryPatchToBible(bible, patch);
  assert.ok(updatedBible.scenes[1].visual_prompt.includes("monsoon rain"));

  // Simulate another edit on sc_03 -> rev2, while patch2 targeted sc_02 -> clean rebase!
  const rev2Bible = structuredClone(bible);
  rev2Bible.scenes[2].mood = "epic";
  const rev2: KrStoryRevision = {
    revision_id: "srev_2",
    project_id: "proj_1",
    version: 2,
    parent_revision_id: "srev_1",
    summary: "Edited sc_03",
    content_sha256: sha256Json(rev2Bible),
    bible: rev2Bible,
    created_at: "2026-11-22T16:05:00Z",
  };
  const rebase = rebaseStoryPatch(rev2, patch);
  assert.equal(rebase.ok, true);
});

test("Director guidance loads licensed instructions and invokes real skill tools", () => {
  const guidance = gatherDirectorGuidance(
    "You lost 3 hours before noticing the stepwell carved under Chand Baori?",
    "Stepwell Echoes",
    [{ id: "1", text: "Meera steps down.", spoken: "Meera steps down.", hero: "Meera" }],
  );
  assert.ok(guidance.instructionsLoaded.length >= 2);
  assert.ok(guidance.skillTraces.every((t) => t.status === "ok"));
});
