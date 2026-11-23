import crypto from "node:crypto";
import { getDbPolicy, getSql } from "../../lib/db.ts";
import { ProjectNotFoundError, StoryRevisionConflictError } from "./route-errors.ts";
import {
  DEFAULT_ZERO_SPEND_POLICY,
  KrJobV1Schema,
  KrTimelineV1Schema,
  type KrJobV1,
  type KrSceneCheckpoint,
  type KrSettingsRevision,
  type KrSettingsSnapshot,
  type KrSkillTraceEntry,
  type KrStoryPatch,
  type KrStoryRevision,
  type KrTimelineV1,
  type KrWorkerEvent,
} from "../../packages/contracts/schemas.ts";
import { KR_FPS, KR_SAMPLE_RATE } from "../../packages/contracts/timing.ts";
import {
  applyStoryPatchToBible,
  buildDefaultStoryBible,
  defaultSettingsSnapshot,
  evaluateDirectorRoute,
  gatherDirectorGuidance,
  proposeStoryPatch,
  rebaseStoryPatch,
  sha256Json,
} from "../../packages/director/index.ts";
import {
  buildTimelineFromStory,
  exportTimelineEditBundle,
  exportTimelineSrt,
} from "../../packages/editor/index.ts";
import { dispatchSkillTool, evaluateSkillRegistry } from "../../packages/skill-runtime/index.ts";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPairingCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function parseJsonCol<T>(val: unknown): T {
  if (typeof val === "string") return JSON.parse(val) as T;
  return val as T;
}

export async function getOrCreateActiveWorkspace(userId: string) {
  const sql = await getSql();
  const existing = await sql<{
    project_id: string;
    title: string;
    logline: string;
    current_story_revision_id: string;
    current_settings_revision_id: string;
    current_timeline_revision_id: string;
    version: number;
  }>`
    SELECT project_id, title, logline, current_story_revision_id, current_settings_revision_id, current_timeline_revision_id, version
    FROM kr_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  if (existing.length > 0) {
    return loadWorkspaceState(userId, existing[0].project_id);
  }

  // Create starter project + immutable v1 story, settings, and timeline revisions
  const projectId = newId("proj");
  const storyRevId = newId("srev");
  const settingsRevId = newId("set");
  const timelineRevId = newId("trev");
  const timelineId = newId("tl");

  const bible = buildDefaultStoryBible(projectId);
  const settings = defaultSettingsSnapshot();
  const timeline = buildTimelineFromStory({
    timeline_id: timelineId,
    project_id: projectId,
    story_revision_id: storyRevId,
    settings_revision_id: settingsRevId,
    bible,
    version: 1,
  });

  await sql`
    INSERT INTO kr_projects (
      project_id, user_id, title, logline,
      current_story_revision_id, current_settings_revision_id, current_timeline_revision_id, version
    ) VALUES (
      ${projectId}, ${userId}, ${bible.title}, ${bible.logline},
      ${storyRevId}, ${settingsRevId}, ${timelineRevId}, 1
    )
  `;

  await sql`
    INSERT INTO kr_story_revisions (
      revision_id, project_id, user_id, version, parent_revision_id, summary, content_sha256, bible_json
    ) VALUES (
      ${storyRevId}, ${projectId}, ${userId}, 1, NULL, 'Initial canonical story bible', ${sha256Json(bible)}, ${JSON.stringify(bible)}::jsonb
    )
  `;

  await sql`
    INSERT INTO kr_settings_revisions (
      settings_revision_id, project_id, user_id, version, snapshot_json
    ) VALUES (
      ${settingsRevId}, ${projectId}, ${userId}, 1, ${JSON.stringify(settings)}::jsonb
    )
  `;

  await sql`
    INSERT INTO kr_timeline_revisions (
      timeline_revision_id, timeline_id, project_id, user_id, version, parent_timeline_revision_id, action_label, timeline_json
    ) VALUES (
      ${timelineRevId}, ${timelineId}, ${projectId}, ${userId}, 1, NULL, 'Initial bilingual storyboard timeline', ${JSON.stringify(timeline)}::jsonb
    )
  `;

  return loadWorkspaceState(userId, projectId);
}

export async function loadWorkspaceState(userId: string, projectId: string) {
  const sql = await getSql();
  const projRows = await sql<{
    project_id: string;
    title: string;
    logline: string;
    current_story_revision_id: string;
    current_settings_revision_id: string;
    current_timeline_revision_id: string;
    version: number;
    updated_at: string;
  }>`
    SELECT project_id, title, logline, current_story_revision_id, current_settings_revision_id, current_timeline_revision_id, version, updated_at::text
    FROM kr_projects
    WHERE project_id = ${projectId} AND user_id = ${userId}
    LIMIT 1
  `;

  if (projRows.length === 0) {
    throw new ProjectNotFoundError("Project not found");
  }
  const project = projRows[0];

  const [storyRow] = await sql<{
    revision_id: string;
    version: number;
    parent_revision_id: string | null;
    summary: string;
    content_sha256: string;
    bible_json: unknown;
    created_at: string;
  }>`
    SELECT revision_id, version, parent_revision_id, summary, content_sha256, bible_json, created_at::text
    FROM kr_story_revisions
    WHERE revision_id = ${project.current_story_revision_id} AND user_id = ${userId}
    LIMIT 1
  `;

  const [settingsRow] = await sql<{
    settings_revision_id: string;
    version: number;
    snapshot_json: unknown;
    created_at: string;
  }>`
    SELECT settings_revision_id, version, snapshot_json, created_at::text
    FROM kr_settings_revisions
    WHERE settings_revision_id = ${project.current_settings_revision_id} AND user_id = ${userId}
    LIMIT 1
  `;

  const [timelineRow] = await sql<{
    timeline_revision_id: string;
    timeline_id: string;
    version: number;
    timeline_json: unknown;
    created_at: string;
  }>`
    SELECT timeline_revision_id, timeline_id, version, timeline_json, created_at::text
    FROM kr_timeline_revisions
    WHERE timeline_revision_id = ${project.current_timeline_revision_id} AND user_id = ${userId}
    LIMIT 1
  `;

  const patches = await sql<{
    patch_id: string;
    base_story_revision_id: string;
    status: KrStoryPatch["status"];
    summary: string;
    operations_json: unknown;
    created_at: string;
  }>`
    SELECT patch_id, base_story_revision_id, status, summary, operations_json, created_at::text
    FROM kr_story_patches
    WHERE project_id = ${projectId} AND user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 12
  `;

  const jobs = await sql<{
    job_id: string;
    status: KrJobV1["status"];
    job_json: unknown;
    updated_at: string;
  }>`
    SELECT job_id, status, job_json, updated_at::text
    FROM kr_jobs
    WHERE project_id = ${projectId} AND user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 10
  `;

  const workerSessions = await sql<{
    worker_session_id: string;
    runtime_kind: string;
    status: string;
    gpu_name: string | null;
    last_heartbeat_at: string | null;
    created_at: string;
  }>`
    SELECT worker_session_id, runtime_kind, status, gpu_name, last_heartbeat_at::text, created_at::text
    FROM kr_worker_sessions
    WHERE project_id = ${projectId} AND user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  const exportsRows = await sql<{
    export_id: string;
    timeline_revision_id: string;
    format: string;
    status: string;
    drive_file_id: string | null;
    file_name: string;
    byte_size: number;
    checksum_sha256: string | null;
    error_message: string | null;
    created_at: string;
  }>`
    SELECT export_id, timeline_revision_id, format, status, drive_file_id, file_name, byte_size, checksum_sha256, error_message, created_at::text
    FROM kr_exports
    WHERE project_id = ${projectId} AND user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 15
  `;

  const connectionRows = await sql<{
    connection_id: string;
    provider: string;
    status: string;
    account_label: string | null;
    encrypted_secret: string | null;
    verified_at: string | null;
    last_error: string | null;
    updated_at: string;
  }>`
    SELECT connection_id, provider, status, account_label, encrypted_secret, verified_at::text, last_error, updated_at::text
    FROM kr_connections
    WHERE user_id = ${userId}
    ORDER BY provider ASC
  `;

  const traceRows = await sql<{
    trace_id: string;
    skill_id: string;
    tool_name: string;
    status: KrSkillTraceEntry["status"];
    duration_ms: number;
    input_summary: unknown;
    output_summary: unknown;
    created_at: string;
  }>`
    SELECT trace_id, skill_id, tool_name, status, duration_ms, input_summary, output_summary, created_at::text
    FROM kr_skill_traces
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 25
  `;

  const activeJobIds = jobs.slice(0, 1).map((j) => j.job_id);
  const events =
    activeJobIds.length > 0
      ? await sql<{
          event_id: string;
          job_id: string;
          worker_session_id: string;
          seq: number;
          scene_id: string | null;
          stage: KrWorkerEvent["stage"];
          level: KrWorkerEvent["level"];
          message: string;
          payload_json: unknown;
          created_at: string;
        }>`
          SELECT event_id, job_id, worker_session_id, seq, scene_id, stage, level, message, payload_json, created_at::text
          FROM kr_worker_events
          WHERE job_id = ${activeJobIds[0]}
          ORDER BY seq DESC
          LIMIT 40
        `
      : [];

  const activeWorker = workerSessions.some((w) => w.status === "active");
  const skillsReport = evaluateSkillRegistry({ verifyHashes: false, workerActive: activeWorker });
  const dbPolicy = getDbPolicy();

  return {
    runtime: {
      db_mode: dbPolicy.mode,
      is_ephemeral_fixture: dbPolicy.isEphemeralFixture,
      label: dbPolicy.label,
    },
    project,
    storyRevision: {
      revision_id: storyRow.revision_id,
      project_id: projectId,
      version: storyRow.version,
      parent_revision_id: storyRow.parent_revision_id,
      summary: storyRow.summary,
      content_sha256: storyRow.content_sha256,
      bible: parseJsonCol<KrStoryRevision["bible"]>(storyRow.bible_json),
      created_at: storyRow.created_at,
    } satisfies KrStoryRevision,
    settingsRevision: {
      settings_revision_id: settingsRow.settings_revision_id,
      project_id: projectId,
      version: settingsRow.version,
      snapshot: parseJsonCol<KrSettingsSnapshot>(settingsRow.snapshot_json),
      created_at: settingsRow.created_at,
    } satisfies KrSettingsRevision,
    timelineRevisionId: timelineRow.timeline_revision_id,
    timeline: parseJsonCol<KrTimelineV1>(timelineRow.timeline_json),
    patches: patches.map((p) => ({
      patch_id: p.patch_id,
      project_id: projectId,
      base_story_revision_id: p.base_story_revision_id,
      status: p.status,
      summary: p.summary,
      operations: parseJsonCol<KrStoryPatch["operations"]>(p.operations_json),
      created_at: p.created_at,
    })),
    jobs: jobs.map((j) => parseJsonCol<KrJobV1>(j.job_json)),
    workerSessions,
    workerEvents: events.map((e) => ({
      event_id: e.event_id,
      job_id: e.job_id,
      worker_session_id: e.worker_session_id,
      seq: e.seq,
      scene_id: e.scene_id,
      stage: e.stage,
      level: e.level,
      message: e.message,
      payload: parseJsonCol<Record<string, unknown>>(e.payload_json),
      created_at: e.created_at,
    })),
    exports: exportsRows,
    connections: connectionRows.map((c) => ({
      connection_id: c.connection_id,
      provider: c.provider,
      status: c.status,
      account_label: c.account_label,
      secret_preview: maskSecret(c.encrypted_secret),
      verified_at: c.verified_at,
      last_error: c.last_error,
      updated_at: c.updated_at,
    })),
    skillTraces: traceRows.map((t) => ({
      trace_id: t.trace_id,
      skill_id: t.skill_id,
      tool_name: t.tool_name,
      status: t.status,
      duration_ms: t.duration_ms,
      input_summary: parseJsonCol<Record<string, unknown>>(t.input_summary),
      output_summary: parseJsonCol<Record<string, unknown>>(t.output_summary),
      created_at: t.created_at,
    })),
    skillsReport,
  };
}

export async function recordSkillTrace(
  userId: string,
  projectId: string | null,
  trace: KrSkillTraceEntry,
): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO kr_skill_traces (
      trace_id, user_id, project_id, skill_id, tool_name, status, duration_ms, input_summary, output_summary
    ) VALUES (
      ${trace.trace_id}, ${userId}, ${projectId}, ${trace.skill_id}, ${trace.tool_name},
      ${trace.status}, ${trace.duration_ms}, ${JSON.stringify(trace.input_summary)}::jsonb, ${JSON.stringify(trace.output_summary)}::jsonb
    )
  `;
}

export async function createStoryPatchProposal(
  userId: string,
  projectId: string,
  instruction: string,
  expectedStoryRevisionId?: string,
) {
  const state = await loadWorkspaceState(userId, projectId);
  if (
    expectedStoryRevisionId &&
    state.storyRevision.revision_id !== expectedStoryRevisionId
  ) {
    throw new StoryRevisionConflictError(
      `Story moved to v${state.storyRevision.version}; refresh before proposing a patch.`,
    );
  }
  const routeCheck = evaluateDirectorRoute(
    state.settingsRevision.snapshot.director_route,
    state.settingsRevision.snapshot.zero_spend,
  );
  if (!routeCheck.ok) {
    throw new Error(routeCheck.reason);
  }

  const guidance = gatherDirectorGuidance(
    state.storyRevision.bible.scenes[0]?.en_narration ?? "",
    state.storyRevision.bible.title,
    state.storyRevision.bible.scenes.map((s) => ({
      id: s.scene_id,
      text: s.en_narration,
      spoken: s.en_narration,
      hero: state.storyRevision.bible.characters[0]?.name ?? "Meera",
    })),
  );

  for (const trace of guidance.skillTraces) {
    await recordSkillTrace(userId, projectId, trace);
  }

  const { patch, assistantMessage } = proposeStoryPatch({
    revision: state.storyRevision,
    instruction,
  });

  const sql = await getSql();
  await sql`
    INSERT INTO kr_story_patches (
      patch_id, project_id, user_id, base_story_revision_id, status, summary, operations_json
    ) VALUES (
      ${patch.patch_id}, ${projectId}, ${userId}, ${patch.base_story_revision_id},
      ${patch.status}, ${patch.summary}, ${JSON.stringify(patch.operations)}::jsonb
    )
  `;

  return {
    patch,
    assistantMessage,
    instructionsLoaded: guidance.instructionsLoaded,
    skillTraces: guidance.skillTraces,
  };
}

export async function resolveStoryPatch(params: {
  userId: string;
  projectId: string;
  patchId: string;
  action: "accept" | "reject" | "rebase";
}) {
  const { userId, projectId, patchId, action } = params;
  const sql = await getSql();
  const state = await loadWorkspaceState(userId, projectId);
  const patch = state.patches.find((p) => p.patch_id === patchId);
  if (!patch) throw new Error("Patch not found");

  if (action === "reject") {
    await sql`
      UPDATE kr_story_patches
      SET status = 'rejected', resolved_at = NOW()
      WHERE patch_id = ${patchId} AND user_id = ${userId}
    `;
    return { status: "rejected" as const, storyRevision: state.storyRevision };
  }

  let effectivePatch = patch;
  if (patch.base_story_revision_id !== state.storyRevision.revision_id) {
    if (action === "accept") {
      return {
        status: "conflict" as const,
        reason: `Patch targets an older story revision; click Rebase to validate against v${state.storyRevision.version}.`,
      };
    }
    const rebased = rebaseStoryPatch(state.storyRevision, patch);
    if (!rebased.ok) {
      return { status: "conflict" as const, reason: rebased.conflictReason };
    }
    effectivePatch = rebased.rebasedPatch;
    if (action === "rebase") {
      await sql`
        UPDATE kr_story_patches
        SET base_story_revision_id = ${effectivePatch.base_story_revision_id},
            status = 'rebased',
            summary = ${effectivePatch.summary}
        WHERE patch_id = ${patchId} AND user_id = ${userId}
      `;
      return { status: "rebased" as const, patch: effectivePatch, storyRevision: state.storyRevision };
    }
  }

  const nextBible = applyStoryPatchToBible(state.storyRevision.bible, effectivePatch);
  const nextVersion = state.storyRevision.version + 1;
  const nextRevId = newId("srev");

  await sql`
    INSERT INTO kr_story_revisions (
      revision_id, project_id, user_id, version, parent_revision_id, summary, content_sha256, bible_json
    ) VALUES (
      ${nextRevId}, ${projectId}, ${userId}, ${nextVersion}, ${state.storyRevision.revision_id},
      ${effectivePatch.summary}, ${sha256Json(nextBible)}, ${JSON.stringify(nextBible)}::jsonb
    )
  `;

  // Rebuild timeline revision anchored to new story revision while preserving audio stems
  const nextTimeline = buildTimelineFromStory({
    timeline_id: state.timeline.timeline_id,
    project_id: projectId,
    story_revision_id: nextRevId,
    settings_revision_id: state.settingsRevision.settings_revision_id,
    bible: nextBible,
    version: state.timeline.version + 1,
  });
  nextTimeline.stems = state.timeline.stems;
  const nextTimelineRevId = newId("trev");

  await sql`
    INSERT INTO kr_timeline_revisions (
      timeline_revision_id, timeline_id, project_id, user_id, version, parent_timeline_revision_id, action_label, timeline_json
    ) VALUES (
      ${nextTimelineRevId}, ${nextTimeline.timeline_id}, ${projectId}, ${userId},
      ${nextTimeline.version}, ${state.timelineRevisionId}, ${`Applied patch: ${effectivePatch.summary}`}, ${JSON.stringify(nextTimeline)}::jsonb
    )
  `;

  await sql`
    UPDATE kr_story_patches
    SET status = 'accepted', resolved_at = NOW()
    WHERE patch_id = ${patchId} AND user_id = ${userId}
  `;

  await sql`
    UPDATE kr_projects
    SET current_story_revision_id = ${nextRevId},
        current_timeline_revision_id = ${nextTimelineRevId},
        version = version + 1,
        updated_at = NOW()
    WHERE project_id = ${projectId} AND user_id = ${userId}
  `;

  return { status: "accepted" as const, nextRevisionId: nextRevId };
}

export async function toggleSceneCanonLock(
  userId: string,
  projectId: string,
  sceneId: string,
  locked: boolean,
) {
  const sql = await getSql();
  const state = await loadWorkspaceState(userId, projectId);
  const nextBible = structuredClone(state.storyRevision.bible);
  const scene = nextBible.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new Error("Scene not found");
  scene.locked_canon = locked;

  const nextRevId = newId("srev");
  const nextVer = state.storyRevision.version + 1;
  await sql`
    INSERT INTO kr_story_revisions (
      revision_id, project_id, user_id, version, parent_revision_id, summary, content_sha256, bible_json
    ) VALUES (
      ${nextRevId}, ${projectId}, ${userId}, ${nextVer}, ${state.storyRevision.revision_id},
      ${`${locked ? "Locked" : "Unlocked"} canon on ${sceneId}`}, ${sha256Json(nextBible)}, ${JSON.stringify(nextBible)}::jsonb
    )
  `;
  await sql`
    UPDATE kr_projects
    SET current_story_revision_id = ${nextRevId}, version = version + 1, updated_at = NOW()
    WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  return { revision_id: nextRevId, version: nextVer };
}

export async function saveSettingsRevision(
  userId: string,
  projectId: string,
  patch: Partial<KrSettingsSnapshot>,
) {
  const sql = await getSql();
  const state = await loadWorkspaceState(userId, projectId);
  const prev = state.settingsRevision.snapshot;

  // Enforce strict zero-spend regardless of client payload
  const nextSnapshot: KrSettingsSnapshot = {
    ...prev,
    ...patch,
    image_baseline: prev.image_baseline, // FLUX.2 Klein 1344x768 Qwen3 baseline is locked
    zero_spend: DEFAULT_ZERO_SPEND_POLICY,
  };

  const routeDecision = evaluateDirectorRoute(nextSnapshot.director_route, nextSnapshot.zero_spend);
  if (!routeDecision.ok) {
    throw new Error(routeDecision.reason);
  }

  const nextId = newId("set");
  const nextVersion = state.settingsRevision.version + 1;
  await sql`
    INSERT INTO kr_settings_revisions (
      settings_revision_id, project_id, user_id, version, snapshot_json
    ) VALUES (
      ${nextId}, ${projectId}, ${userId}, ${nextVersion}, ${JSON.stringify(nextSnapshot)}::jsonb
    )
  `;

  await sql`
    UPDATE kr_projects
    SET current_settings_revision_id = ${nextId}, version = version + 1, updated_at = NOW()
    WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  return { settings_revision_id: nextId, version: nextVersion, snapshot: nextSnapshot };
}

export async function confirmAndEnqueueProductionJob(params: {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  confirmedByUser: boolean;
}) {
  if (!params.confirmedByUser) {
    throw new Error("Explicit user production confirmation is required before queuing a job.");
  }
  const sql = await getSql();
  const state = await loadWorkspaceState(params.userId, params.projectId);

  // Idempotent return if same key already confirmed
  const existing = await sql<{ job_json: unknown }>`
    SELECT job_json FROM kr_jobs
    WHERE project_id = ${params.projectId} AND idempotency_key = ${params.idempotencyKey} AND user_id = ${params.userId}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return { deduplicated: true, job: parseJsonCol<KrJobV1>(existing[0].job_json) };
  }

  const routeCheck = evaluateDirectorRoute(
    state.settingsRevision.snapshot.director_route,
    state.settingsRevision.snapshot.zero_spend,
  );
  if (!routeCheck.ok) {
    throw new Error(routeCheck.reason);
  }

  const now = new Date().toISOString();
  const checkpoints: KrSceneCheckpoint[] = state.storyRevision.bible.scenes.map((sc) => ({
    scene_id: sc.scene_id,
    order_index: sc.order_index,
    stage: "queued",
    status: "pending",
    attempt: 0,
    image_drive_id: null,
    image_local_path: null,
    hi_audio_drive_id: null,
    hi_audio_samples: 0,
    en_audio_drive_id: null,
    en_audio_samples: 0,
    composed_mp4_drive_id: null,
    duration_frames: 0,
    verified: false,
    error_code: null,
    error_message: null,
    updated_at: now,
  }));

  const job: KrJobV1 = KrJobV1Schema.parse({
    schema_version: "kr.job.v1",
    job_id: newId("job"),
    project_id: params.projectId,
    story_revision_id: state.storyRevision.revision_id,
    settings_revision_id: state.settingsRevision.settings_revision_id,
    idempotency_key: params.idempotencyKey,
    confirmed_by_user: true,
    status: "queued",
    fps: KR_FPS,
    sample_rate: KR_SAMPLE_RATE,
    zero_spend: DEFAULT_ZERO_SPEND_POLICY,
    lease_token: null,
    lease_expires_at: null,
    worker_session_id: null,
    current_scene_index: 0,
    scenes: state.storyRevision.bible.scenes,
    checkpoints,
    settings: state.settingsRevision.snapshot,
    created_at: now,
    updated_at: now,
  });

  await sql`
    INSERT INTO kr_jobs (
      job_id, project_id, user_id, story_revision_id, settings_revision_id,
      idempotency_key, confirmed_by_user, status, current_scene_index, job_json
    ) VALUES (
      ${job.job_id}, ${job.project_id}, ${params.userId}, ${job.story_revision_id}, ${job.settings_revision_id},
      ${job.idempotency_key}, TRUE, ${job.status}, 0, ${JSON.stringify(job)}::jsonb
    )
  `;

  return { deduplicated: false, job };
}

export async function createWorkerPairingSession(
  userId: string,
  projectId: string,
  runtimeKind: "colab_free_gpu" | "local_python_worker" = "colab_free_gpu",
) {
  const sql = await getSql();
  const owned = await sql<{ project_id: string }>`
    SELECT project_id FROM kr_projects
    WHERE project_id = ${projectId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (owned.length === 0) {
    throw new ProjectNotFoundError("Project not found");
  }
  const workerSessionId = newId("ws");
  const pairingCode = `KR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const codeHash = hashPairingCode(pairingCode);

  await sql`
    INSERT INTO kr_worker_sessions (
      worker_session_id, user_id, project_id, pairing_code_hash, runtime_kind, status
    ) VALUES (
      ${workerSessionId}, ${userId}, ${projectId}, ${codeHash}, ${runtimeKind}, 'paired'
    )
  `;

  return {
    worker_session_id: workerSessionId,
    pairing_code: pairingCode,
    runtime_kind: runtimeKind,
  };
}

export async function claimJobForWorker(params: {
  pairingCode: string;
  gpuName?: string;
  capabilities?: Record<string, unknown>;
}) {
  const sql = await getSql();
  const codeHash = hashPairingCode(params.pairingCode);
  const sessions = await sql<{
    worker_session_id: string;
    user_id: string;
    project_id: string;
  }>`
    SELECT worker_session_id, user_id, project_id
    FROM kr_worker_sessions
    WHERE pairing_code_hash = ${codeHash} AND status IN ('paired', 'active')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (sessions.length === 0) {
    throw new Error("Invalid or revoked worker pairing code");
  }
  const session = sessions[0];

  await sql`
    UPDATE kr_worker_sessions
    SET status = 'active',
        gpu_name = ${params.gpuName ?? "Colab Free GPU"},
        capabilities_json = ${JSON.stringify(params.capabilities ?? {})}::jsonb,
        last_heartbeat_at = NOW()
    WHERE worker_session_id = ${session.worker_session_id}
  `;

  const jobs = await sql<{ job_id: string; job_json: unknown }>`
    SELECT job_id, job_json
    FROM kr_jobs
    WHERE project_id = ${session.project_id}
      AND user_id = ${session.user_id}
      AND status IN ('queued', 'running', 'claimed')
      AND (lease_expires_at IS NULL OR lease_expires_at < NOW() OR worker_session_id = ${session.worker_session_id})
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (jobs.length === 0) {
    return { worker_session_id: session.worker_session_id, job: null };
  }

  const leaseToken = newId("lease");
  const leaseExpires = new Date(Date.now() + 120_000).toISOString();
  const job = parseJsonCol<KrJobV1>(jobs[0].job_json);
  const updatedJob: KrJobV1 = {
    ...job,
    status: "claimed",
    lease_token: leaseToken,
    lease_expires_at: leaseExpires,
    worker_session_id: session.worker_session_id,
    updated_at: new Date().toISOString(),
  };

  await sql`
    UPDATE kr_jobs
    SET status = 'claimed',
        lease_token = ${leaseToken},
        lease_expires_at = ${leaseExpires}::timestamptz,
        worker_session_id = ${session.worker_session_id},
        job_json = ${JSON.stringify(updatedJob)}::jsonb,
        updated_at = NOW()
    WHERE job_id = ${job.job_id}
  `;

  return { worker_session_id: session.worker_session_id, lease_token: leaseToken, job: updatedJob };
}

export async function postWorkerCheckpoint(params: {
  jobId: string;
  workerSessionId: string;
  leaseToken: string;
  seq: number;
  sceneId: string;
  stage: KrWorkerEvent["stage"];
  checkpointPatch: Partial<KrSceneCheckpoint>;
  message: string;
  level?: "info" | "warn" | "error";
}) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string; project_id: string; lease_token: string | null; job_json: unknown }>`
    SELECT user_id, project_id, lease_token, job_json
    FROM kr_jobs
    WHERE job_id = ${params.jobId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error("Job not found");
  const row = rows[0];
  if (row.lease_token !== params.leaseToken) {
    throw new Error("Stale or mismatched lease_token (lease fencing rejected)");
  }

  const job = parseJsonCol<KrJobV1>(row.job_json);
  if (job.worker_session_id && job.worker_session_id !== params.workerSessionId) {
    throw new Error("Mismatched worker_session_id (session fencing rejected)");
  }
  const cpIdx = job.checkpoints.findIndex((c) => c.scene_id === params.sceneId);
  if (cpIdx < 0) throw new Error(`Scene checkpoint ${params.sceneId} not found`);

  // Enforce sequential waterfall: cannot advance scene N if scene N-1 isn't completed
  if (cpIdx > 0 && job.checkpoints[cpIdx - 1].status !== "completed") {
    throw new Error(`Waterfall gate: scene ${job.checkpoints[cpIdx - 1].scene_id} must complete before ${params.sceneId}`);
  }

  const now = new Date().toISOString();
  const prevCp = job.checkpoints[cpIdx];
  const nextCp: KrSceneCheckpoint = {
    ...prevCp,
    ...params.checkpointPatch,
    stage: params.stage,
    updated_at: now,
  };

  const nextCheckpoints = job.checkpoints.map((c, i) => (i === cpIdx ? nextCp : c));
  const allCompleted = nextCheckpoints.every((c) => c.status === "completed");
  const anyFailed = nextCheckpoints.some((c) => c.status === "failed");
  const nextStatus: KrJobV1["status"] = anyFailed
    ? "failed"
    : allCompleted
      ? "completed"
      : "running";

  const leaseExpires = new Date(Date.now() + 120_000).toISOString();
  const nextJob: KrJobV1 = {
    ...job,
    status: nextStatus,
    lease_expires_at: leaseExpires,
    current_scene_index: cpIdx,
    checkpoints: nextCheckpoints,
    updated_at: now,
  };

  await sql`
    UPDATE kr_jobs
    SET status = ${nextStatus},
        lease_expires_at = ${leaseExpires}::timestamptz,
        current_scene_index = ${cpIdx},
        job_json = ${JSON.stringify(nextJob)}::jsonb,
        updated_at = NOW()
    WHERE job_id = ${params.jobId} AND lease_token = ${params.leaseToken}
  `;

  await sql`
    UPDATE kr_worker_sessions
    SET last_heartbeat_at = NOW(), status = 'active'
    WHERE worker_session_id = ${params.workerSessionId}
  `;

  await sql`
    INSERT INTO kr_worker_events (
      event_id, job_id, worker_session_id, seq, scene_id, stage, level, message, payload_json
    ) VALUES (
      ${newId("evt")}, ${params.jobId}, ${params.workerSessionId}, ${params.seq},
      ${params.sceneId}, ${params.stage}, ${params.level ?? "info"}, ${params.message}, ${JSON.stringify(params.checkpointPatch)}::jsonb
    )
    ON CONFLICT (job_id, seq) DO NOTHING
  `;

  // When a scene reaches timeline_append/completed with verified media, attach Drive IDs onto the latest timeline revision
  if (nextCp.status === "completed" && nextCp.verified) {
    const state = await loadWorkspaceState(row.user_id, row.project_id);
    const updatedClips = state.timeline.clips.map((c) =>
      c.scene_id === params.sceneId
        ? {
            ...c,
            drive_image_id: nextCp.image_drive_id ?? c.drive_image_id,
            drive_mp4_id: nextCp.composed_mp4_drive_id ?? c.drive_mp4_id,
            hi_audio_samples: nextCp.hi_audio_samples || c.hi_audio_samples,
            en_audio_samples: nextCp.en_audio_samples || c.en_audio_samples,
          }
        : c,
    );
    const nextTimeline: KrTimelineV1 = {
      ...state.timeline,
      version: state.timeline.version + 1,
      clips: updatedClips,
      updated_at: now,
    };
    const nextRevId = newId("trev");
    await sql`
      INSERT INTO kr_timeline_revisions (
        timeline_revision_id, timeline_id, project_id, user_id, version, parent_timeline_revision_id, action_label, timeline_json
      ) VALUES (
        ${nextRevId}, ${nextTimeline.timeline_id}, ${row.project_id}, ${row.user_id},
        ${nextTimeline.version}, ${state.timelineRevisionId}, ${`Worker scene ${params.sceneId} appended`}, ${JSON.stringify(nextTimeline)}::jsonb
      )
    `;
    await sql`
      UPDATE kr_projects
      SET current_timeline_revision_id = ${nextRevId}, version = version + 1, updated_at = NOW()
      WHERE project_id = ${row.project_id} AND user_id = ${row.user_id}
    `;
  }

  return nextJob;
}

export async function saveTimelineEditRevision(params: {
  userId: string;
  projectId: string;
  expectedVersion: number;
  actionLabel: string;
  timeline: KrTimelineV1;
}) {
  const parsed = KrTimelineV1Schema.parse(params.timeline);
  const sql = await getSql();
  const state = await loadWorkspaceState(params.userId, params.projectId);

  if (state.timeline.version !== params.expectedVersion) {
    return {
      conflict: true as const,
      expected: params.expectedVersion,
      actual: state.timeline.version,
      latestTimeline: state.timeline,
    };
  }

  const nextVersion = state.timeline.version + 1;
  const nextTimeline: KrTimelineV1 = {
    ...parsed,
    version: nextVersion,
    updated_at: new Date().toISOString(),
  };
  const nextRevId = newId("trev");

  await sql`
    INSERT INTO kr_timeline_revisions (
      timeline_revision_id, timeline_id, project_id, user_id, version, parent_timeline_revision_id, action_label, timeline_json
    ) VALUES (
      ${nextRevId}, ${nextTimeline.timeline_id}, ${params.projectId}, ${params.userId},
      ${nextVersion}, ${state.timelineRevisionId}, ${params.actionLabel}, ${JSON.stringify(nextTimeline)}::jsonb
    )
  `;

  await sql`
    UPDATE kr_projects
    SET current_timeline_revision_id = ${nextRevId}, version = version + 1, updated_at = NOW()
    WHERE project_id = ${params.projectId} AND user_id = ${params.userId}
  `;

  return { conflict: false as const, timelineRevisionId: nextRevId, timeline: nextTimeline };
}

export async function upsertConnection(params: {
  userId: string;
  provider: "google_drive" | "google_gemini_free" | "groq_free" | "openrouter_free";
  accountLabel: string;
  secretValue?: string;
}) {
  const sql = await getSql();
  const connId = newId("conn");
  const hasSecret = Boolean(params.secretValue && params.secretValue.trim().length >= 8);
  const status = hasSecret ? "configured" : "disconnected";

  await sql`
    INSERT INTO kr_connections (
      connection_id, user_id, provider, status, account_label, encrypted_secret
    ) VALUES (
      ${connId}, ${params.userId}, ${params.provider}, ${status}, ${params.accountLabel}, ${params.secretValue?.trim() ?? null}
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      status = EXCLUDED.status,
      account_label = EXCLUDED.account_label,
      encrypted_secret = COALESCE(EXCLUDED.encrypted_secret, kr_connections.encrypted_secret),
      verified_at = NULL,
      last_error = NULL,
      updated_at = NOW()
  `;

  return {
    provider: params.provider,
    status,
    secret_preview: maskSecret(params.secretValue),
  };
}

export async function createOrRenderExport(params: {
  userId: string;
  projectId: string;
  format: "mp4_hi" | "mp4_en" | "srt_hi" | "srt_en" | "bundle_json";
}) {
  const sql = await getSql();
  const state = await loadWorkspaceState(params.userId, params.projectId);
  const exportId = newId("exp");
  const slug = state.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28) || "katharift";

  if (params.format === "srt_hi" || params.format === "srt_en") {
    const lang = params.format === "srt_hi" ? "hi" : "en";
    const srt = exportTimelineSrt(state.timeline, lang);
    const buf = Buffer.from(srt, "utf8");
    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    const fileName = `${slug}-v${state.timeline.version}.${lang}.srt`;

    await sql`
      INSERT INTO kr_exports (
        export_id, project_id, user_id, timeline_revision_id, format, status, file_name, byte_size, checksum_sha256
      ) VALUES (
        ${exportId}, ${params.projectId}, ${params.userId}, ${state.timelineRevisionId},
        ${params.format}, 'ready', ${fileName}, ${buf.byteLength}, ${checksum}
      )
    `;
    return {
      export_id: exportId,
      status: "ready" as const,
      file_name: fileName,
      content: srt,
      mime: "text/plain; charset=utf-8",
      deduplicated: false,
      message: `Downloaded ${fileName} (${buf.byteLength} bytes).`,
    };
  }

  if (params.format === "bundle_json") {
    const bundle = exportTimelineEditBundle(state.timeline);
    const jsonText = JSON.stringify(bundle, null, 2);
    const buf = Buffer.from(jsonText, "utf8");
    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    const fileName = `${slug}-v${state.timeline.version}.edit-bundle.json`;

    await sql`
      INSERT INTO kr_exports (
        export_id, project_id, user_id, timeline_revision_id, format, status, file_name, byte_size, checksum_sha256
      ) VALUES (
        ${exportId}, ${params.projectId}, ${params.userId}, ${state.timelineRevisionId},
        'bundle_json', 'ready', ${fileName}, ${buf.byteLength}, ${checksum}
      )
    `;
    return {
      export_id: exportId,
      status: "ready" as const,
      file_name: fileName,
      content: jsonText,
      mime: "application/json",
      deduplicated: false,
      message: `Downloaded ${fileName} (${buf.byteLength} bytes).`,
    };
  }

  // MP4 exports (mp4_hi / mp4_en): deduplicate active queued/rendering exports for the same
  // owner/project/timeline revision/format, and honestly report worker/media requirement.
  const existingActive = await sql<{
    export_id: string;
    status: string;
    file_name: string;
    error_message: string | null;
  }>`
    SELECT export_id, status, file_name, error_message
    FROM kr_exports
    WHERE user_id = ${params.userId}
      AND project_id = ${params.projectId}
      AND timeline_revision_id = ${state.timelineRevisionId}
      AND format = ${params.format}
      AND status IN ('queued', 'rendering')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (existingActive.length > 0) {
    const existing = existingActive[0];
    return {
      export_id: existing.export_id,
      status: existing.status,
      file_name: existing.file_name,
      content: null,
      mime: "video/mp4",
      deduplicated: true,
      message: `Queued, not rendered; worker/media required. Reusing active queue entry for Timeline v${state.timeline.version}.`,
    };
  }

  const lang = params.format === "mp4_hi" ? "hi" : "en";
  const fileName = `${slug}-v${state.timeline.version}.${lang}.mp4`;
  const queueReason = "Queued, not rendered; worker/media required.";
  await sql`
    INSERT INTO kr_exports (
      export_id, project_id, user_id, timeline_revision_id, format, status, file_name, error_message
    ) VALUES (
      ${exportId}, ${params.projectId}, ${params.userId}, ${state.timelineRevisionId},
      ${params.format}, 'queued', ${fileName}, ${queueReason}
    )
  `;
  return {
    export_id: exportId,
    status: "queued" as const,
    file_name: fileName,
    content: null,
    mime: "video/mp4",
    deduplicated: false,
    message: queueReason,
  };
}

export async function runPackagingSkillCheck(userId: string, projectId: string, title: string, thumbText?: string) {
  const state = await loadWorkspaceState(userId, projectId);
  const titleRes = dispatchSkillTool("youtube_lint_title", {
    title,
    thumbnail_text: thumbText || undefined,
  });
  await recordSkillTrace(userId, projectId, titleRes.trace);

  const srtHi = exportTimelineSrt(state.timeline, "hi");
  const deadairRes = srtHi.trim()
    ? dispatchSkillTool("youtube_detect_deadair", { srt_content: srtHi, floor_sec: 0.45 })
    : null;
  if (deadairRes) {
    await recordSkillTrace(userId, projectId, deadairRes.trace);
  }

  return { titleRes, deadairRes };
}
