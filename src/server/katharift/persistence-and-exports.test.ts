import test from "node:test";
import assert from "node:assert/strict";
import { trimClipOutEdge, updateAudioStem } from "../../packages/editor/engine.ts";
import { StoryRevisionConflictError } from "./route-errors.ts";
import {
  claimJobForWorker,
  createOrRenderExport,
  createStoryPatchProposal,
  createWorkerPairingSession,
  getOrCreateActiveWorkspace,
  loadWorkspaceState,
  resolveStoryPatch,
  revokeWorkerPairingSession,
  saveTimelineEditRevision,
} from "./repository.ts";
import { getSql } from "../../lib/db.ts";

test(
  "[Fixture DB] story edits, timeline saves, SRT/JSON export timing, and MP4 queue deduplication persist across reload",
  async () => {
    const prevEnv = {
      KR_LOCAL_FIXTURE_DB: process.env.KR_LOCAL_FIXTURE_DB,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
      CI: process.env.CI,
    };
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.NODE_ENV;
    delete process.env.CI;
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
      assert.equal(proposal.noOp, false);
      assert.ok(proposal.patch);
      assert.ok(proposal.patch.operations.every((op) => op.target_id === "sc_02"));
      assert.ok(!proposal.patch.operations.some((op) => op.op === "insert_scene"));

      const resolved = await resolveStoryPatch({
        userId,
        projectId,
        patchId: proposal.patch.patch_id,
        action: "accept",
      });
      assert.equal(resolved.status, "accepted");

      // Repeated semantically equivalent proposal on Story v2 returns noOp without duplicating text
      const afterV2 = await getOrCreateActiveWorkspace(userId);
      const repeated = await createStoryPatchProposal(
        userId,
        projectId,
        "Sirf editable scene 2 mein halki baarish ka atmosphere add karo.",
        afterV2.storyRevision.revision_id,
      );
      assert.equal(repeated.noOp, true);
      assert.equal(repeated.patch, null);

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

      // 8. Worker pairing lifecycle honesty: unredeemed code is awaiting_worker (NOT connected/paired),
      //    worker auth transitions to authenticated_paired, targeted revoke affects only that code,
      //    and unredeemed codes older than 15m expire automatically.
      const exposedPair = await createWorkerPairingSession(userId, projectId, "colab_free_gpu");
      assert.equal(exposedPair.lifecycle_state, "awaiting_worker");

      const beforeWorkerState = await loadWorkspaceState(userId, projectId);
      const exposedWs = beforeWorkerState.workerSessions.find(
        (w) => w.worker_session_id === exposedPair.worker_session_id,
      );
      assert.ok(exposedWs);
      assert.equal(exposedWs.lifecycle_state, "awaiting_worker");
      assert.equal(exposedWs.is_connected, false);
      assert.equal(exposedWs.pairing_code_issued_only, true);
      assert.doesNotMatch(exposedWs.label, /^paired$/i);

      // Revoke only the exposed pairing code while keeping a second session intact
      const validPair = await createWorkerPairingSession(userId, projectId, "colab_free_gpu");
      const revoked = await revokeWorkerPairingSession(
        userId,
        projectId,
        exposedPair.worker_session_id,
      );
      assert.equal(revoked.status, "revoked");

      await assert.rejects(
        () => claimJobForWorker({ pairingCode: exposedPair.pairing_code, gpuName: "T4" }),
        /Invalid or revoked/i,
      );

      // Valid second code connects cleanly -> authenticated_paired (no jobs queued)
      const claimedEmpty = await claimJobForWorker({
        pairingCode: validPair.pairing_code,
        gpuName: "Tesla T4",
      });
      assert.equal(claimedEmpty.lifecycle_state, "authenticated_paired");

      const afterConnectState = await loadWorkspaceState(userId, projectId);
      const connectedWs = afterConnectState.workerSessions.find(
        (w) => w.worker_session_id === validPair.worker_session_id,
      );
      const revokedWs = afterConnectState.workerSessions.find(
        (w) => w.worker_session_id === exposedPair.worker_session_id,
      );
      assert.equal(connectedWs?.lifecycle_state, "authenticated_paired");
      assert.equal(connectedWs?.is_connected, true);
      assert.equal(revokedWs?.lifecycle_state, "revoked");
      assert.equal(revokedWs?.is_connected, false);
      // Story revisions remain intact
      assert.equal(afterConnectState.storyRevision.version, 2);

      // Unredeemed pairing session older than 15 minutes auto-expires
      const stalePair = await createWorkerPairingSession(userId, projectId, "colab_free_gpu");
      const sql = await getSql();
      const twentyMinsAgo = new Date(Date.now() - 20 * 60_000).toISOString();
      await sql`
        UPDATE kr_worker_sessions
        SET created_at = ${twentyMinsAgo}::timestamptz
        WHERE worker_session_id = ${stalePair.worker_session_id}
      `;
      const afterExpiryState = await loadWorkspaceState(userId, projectId);
      const expiredWs = afterExpiryState.workerSessions.find(
        (w) => w.worker_session_id === stalePair.worker_session_id,
      );
      assert.equal(expiredWs?.lifecycle_state, "expired");
      assert.equal(expiredWs?.is_connected, false);
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  },
);
