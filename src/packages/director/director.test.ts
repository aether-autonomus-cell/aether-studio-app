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
  StoryPatchRequestError,
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

test("Roman-Hindi scene 2 light-rain request preserves ending, characters, and locked scene without inserting a new scene", () => {
  const bible = buildDefaultStoryBible("proj_qa_repro");
  const rev1: KrStoryRevision = {
    revision_id: "srev_qa_1",
    project_id: "proj_qa_repro",
    version: 1,
    parent_revision_id: null,
    summary: "Initial",
    content_sha256: sha256Json(bible),
    bible,
    created_at: "2026-11-23T00:00:00Z",
  };

  const { patch } = proposeStoryPatch({
    revision: rev1,
    instruction:
      "Sirf editable scene 2 mein halki baarish ka atmosphere add karo. Characters, locked scene aur ending ko unchanged rakho.",
  });

  assert.ok(patch.operations.every((op) => op.op === "update_scene"));
  assert.ok(patch.operations.every((op) => op.target_id === "sc_02"));
  assert.ok(!patch.operations.some((op) => op.op === "insert_scene"));

  const applied = applyStoryPatchToBible(bible, patch);
  assert.equal(applied.scenes.length, 3);
  assert.equal(applied.scenes[0].visual_prompt, bible.scenes[0].visual_prompt);
  assert.equal(applied.scenes[2].visual_prompt, bible.scenes[2].visual_prompt);
  assert.deepEqual(applied.characters, bible.characters);
  assert.match(applied.scenes[1].visual_prompt, /light monsoon rain/i);
});

test("Story patch fails closed on locked-scene targeting, missing scenes, character edits, and unsupported instructions", () => {
  const bible = buildDefaultStoryBible("proj_qa_guards");
  const rev1: KrStoryRevision = {
    revision_id: "srev_qa_guards",
    project_id: "proj_qa_guards",
    version: 1,
    parent_revision_id: null,
    summary: "Initial",
    content_sha256: sha256Json(bible),
    bible,
    created_at: "2026-11-23T00:00:00Z",
  };

  assert.throws(
    () =>
      proposeStoryPatch({
        revision: rev1,
        instruction: "Scene 1 mein baarish add karo",
      }),
    (err: unknown) => err instanceof StoryPatchRequestError && err.status === 422,
  );

  assert.throws(
    () =>
      proposeStoryPatch({
        revision: rev1,
        instruction: "Scene 9 mein baarish add karo",
      }),
    (err: unknown) => err instanceof StoryPatchRequestError && err.status === 422,
  );

  assert.throws(
    () =>
      proposeStoryPatch({
        revision: rev1,
        instruction: "Change character Kabir into a robot",
      }),
    (err: unknown) => err instanceof StoryPatchRequestError && err.status === 422,
  );

  assert.throws(
    () =>
      proposeStoryPatch({
        revision: rev1,
        instruction: "asdfghjkl unrelated gibberish",
      }),
    (err: unknown) => err instanceof StoryPatchRequestError && err.status === 422,
  );

  // Explicit positive scene addition still succeeds
  const added = proposeStoryPatch({
    revision: rev1,
    instruction: "Add dawn ending scene",
  });
  assert.equal(added.patch.operations[0].op, "insert_scene");
  assert.equal(added.patch.operations[0].target_id, "sc_04");
});
