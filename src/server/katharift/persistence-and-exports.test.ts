import test from "node:test";
import assert from "node:assert/strict";
import { trimClipOutEdge, updateAudioStem } from "../../packages/editor/engine.ts";
import { StoryRevisionConflictError } from "./route-errors.ts";
import {
  createOrRenderExport,
  createStoryPatchProposal,
  getOrCreateActiveWorkspace,
  resolveStoryPatch,
  saveTimelineEditRevision,
} from "./repository.ts";

test(
  "[Fixture DB] story edits, timeline saves, SRT/JSON export timing, and MP4 queue deduplication persist across reload",
  async () => {
    const prevFixture = process.env.KR_LOCAL_FIXTURE_DB;
    process.env.KR_LOCAL_FIXTURE_DB = "true";

    try {
      const userId = "owner_fixture_qa@example.com";

      // 1. Initial workspace creation
      const initial = await getOrCreateActiveWorkspace(userId);
      assert.equal(initial.runtime.is_ephemeral_fixture, true);
      assert.equal(initial.storyRevision.version, 1);
      assert.equal(initial.timeline.version, 1);

      const projectId = initial.project.project_id;
      const initialRevId = initial.storyRevision.revision_id;

      // 2. Propose & accept Roman-Hindi scene 2 light-rain patch
      const proposal = await createStoryPatchProposal(
        userId,
        projectId,
        "Sirf editable scene 2 mein halki baarish ka atmosphere add karo. Characters, locked scene aur ending ko unchanged rakho.",
        initialRevId,
      );
      assert.ok(proposal.patch.operations.every((op) => op.target_id === "sc_02"));
      assert.ok(!proposal.patch.operations.some((op) => op.op === "insert_scene"));

      const resolved = await resolveStoryPatch({
        userId,
        projectId,
        patchId: proposal.patch.patch_id,
        action: "accept",
      });
      assert.equal(resolved.status, "accepted");

      // Stale expected_story_revision_id is rejected cleanly with StoryRevisionConflictError
      await assert.rejects(
        () =>
          createStoryPatchProposal(
            userId,
            projectId,
            "Scene 3 mein shadows add karo",
            initialRevId,
          ),
        (err: unknown) => err instanceof StoryRevisionConflictError && err.status === 409,
      );

      // 3. Simulate browser refresh / relogin -> verify Story v2 & Timeline v2 persisted
      const afterStoryReload = await getOrCreateActiveWorkspace(userId);
      assert.equal(afterStoryReload.storyRevision.version, 2);
      assert.equal(afterStoryReload.storyRevision.bible.scenes.length, 3);
      assert.match(
        afterStoryReload.storyRevision.bible.scenes[1].visual_prompt,
        /light monsoon rain/i,
      );
      assert.equal(afterStoryReload.timeline.version, 2);

      // 4. Edit timeline (trim clip 1 by -24 frames = -1s, mute music stem, switch caption mode) & Save
      const trimmed = trimClipOutEdge(
        afterStoryReload.timeline,
        afterStoryReload.timeline.clips[0].clip_id,
        -24,
      );
      const mixed = updateAudioStem(trimmed, "music", { gain_db: -18, muted: true });
      const editedTimeline = { ...mixed, active_caption_lang: "en" as const };

      const saved = await saveTimelineEditRevision({
        userId,
        projectId,
        expectedVersion: afterStoryReload.timeline.version,
        actionLabel: "Trim scene 1 and mute score",
        timeline: editedTimeline,
      });
      assert.equal(saved.conflict, false);
      if (saved.conflict) return;
      assert.equal(saved.timeline.version, 3);

      // 5. Simulate refresh / relogin -> verify timeline edits persisted
      const afterTimelineReload = await getOrCreateActiveWorkspace(userId);
      assert.equal(afterTimelineReload.timeline.version, 3);
      assert.equal(afterTimelineReload.timeline.active_caption_lang, "en");
      assert.equal(
        afterTimelineReload.timeline.stems.find((s) => s.stem_id === "music")?.muted,
        true,
      );
      assert.equal(
        afterTimelineReload.timeline.clips[0].out_frame,
        afterStoryReload.timeline.clips[0].out_frame - 24,
      );
      assert.equal(
        afterTimelineReload.timeline.total_frames,
        afterStoryReload.timeline.total_frames - 24,
      );

      // 6. Verify SRT and JSON exports reflect the persisted edited timeline timing & contents
      const srtHi = await createOrRenderExport({ userId, projectId, format: "srt_hi" });
      const srtEn = await createOrRenderExport({ userId, projectId, format: "srt_en" });
      const bundle = await createOrRenderExport({ userId, projectId, format: "bundle_json" });

      assert.equal(srtHi.status, "ready");
      assert.equal(srtEn.status, "ready");
      assert.equal(bundle.status, "ready");
      // Scene 1 was 8s -> trimmed by 24 frames (1s) => 00:00:07,000
      assert.ok(srtHi.content?.includes("1\n00:00:00,000 --> 00:00:07,000\n"));
      assert.ok(srtEn.content?.includes("1\n00:00:00,000 --> 00:00:07,000\n"));

      const parsedBundle = JSON.parse(bundle.content ?? "{}") as {
        timeline_version: number;
        total_frames: number;
        srt_hi: string;
        srt_en: string;
      };
      assert.equal(parsedBundle.timeline_version, 3);
      assert.equal(parsedBundle.total_frames, afterTimelineReload.timeline.total_frames);
      assert.equal(parsedBundle.srt_hi, srtHi.content);
      assert.equal(parsedBundle.srt_en, srtEn.content);

      // 7. Verify MP4 export queueing honesty & active-export deduplication
      const mp4First = await createOrRenderExport({ userId, projectId, format: "mp4_hi" });
      const mp4Second = await createOrRenderExport({ userId, projectId, format: "mp4_hi" });
      assert.equal(mp4First.status, "queued");
      assert.equal(mp4First.content, null);
      assert.equal(mp4First.deduplicated, false);
      assert.match(mp4First.message, /Queued, not rendered; worker\/media required/i);

      assert.equal(mp4Second.status, "queued");
      assert.equal(mp4Second.export_id, mp4First.export_id);
      assert.equal(mp4Second.deduplicated, true);

      // Reload & ensure only 1 active mp4_hi queued row exists for this timeline revision
      const finalReload = await getOrCreateActiveWorkspace(userId);
      const activeMp4Hi = finalReload.exports.filter(
        (e) =>
          e.timeline_revision_id === finalReload.timelineRevisionId &&
          e.format === "mp4_hi" &&
          e.status === "queued",
      );
      assert.equal(activeMp4Hi.length, 1);
    } finally {
      if (prevFixture === undefined) delete process.env.KR_LOCAL_FIXTURE_DB;
      else process.env.KR_LOCAL_FIXTURE_DB = prevFixture;
    }
  },
);
