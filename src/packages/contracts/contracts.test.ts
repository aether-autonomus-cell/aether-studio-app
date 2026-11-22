import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  KR_FPS,
  KR_SAMPLE_RATE,
  KR_SAMPLES_PER_FRAME,
  allocateCumulativeFrameSpans,
  framesToMs,
  framesToSamples,
  framesToSrtTimestamp,
  samplesToFramesRound,
  spanDurationFrames,
} from "./timing.ts";
import {
  DEFAULT_ZERO_SPEND_POLICY,
  KrJobV1Schema,
  KrTimelineV1Schema,
} from "./schemas.ts";

test("timing constants match 24fps and 48kHz", () => {
  assert.equal(KR_FPS, 24);
  assert.equal(KR_SAMPLE_RATE, 48_000);
  assert.equal(KR_SAMPLES_PER_FRAME, 2000);
  assert.equal(samplesToFramesRound(48_000), 24);
  assert.equal(samplesToFramesRound(24_000), 12);
  assert.equal(framesToSamples(24), 48_000);
  assert.equal(framesToMs(24), 1000);
  assert.equal(framesToSrtTimestamp(24), "00:00:01,000");
});

test("cumulative frame rounding eliminates drift across fractional scenes", () => {
  // Each scene is 1000 samples (0.5 frames) * 4 -> total 4000 samples = exactly 2 frames,
  // but with minFramesPerScene=1 we get contiguous half-open intervals [0,1), [1,2), [2,3)...
  const spans = allocateCumulativeFrameSpans([192_000, 193_000, 191_000], 24);
  assert.equal(spans.length, 3);
  assert.equal(spans[0].inFrame, 0);
  for (let i = 1; i < spans.length; i += 1) {
    assert.equal(spans[i].inFrame, spans[i - 1].outFrame);
    assert.ok(spanDurationFrames(spans[i]) >= 24);
  }
  // Total samples = 576,000 => 576000 * 24 / 48000 = 288 frames exactly
  assert.equal(spans[2].outFrame, 288);
});

test("emitted JSON Schemas exist on disk for kr.job.v1 and kr.timeline.v1", () => {
  const jobSchema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "shared/kr.job.v1.schema.json"), "utf8"));
  const tlSchema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "shared/kr.timeline.v1.schema.json"), "utf8"));
  assert.equal(jobSchema.properties.schema_version.const, "kr.job.v1");
  assert.equal(tlSchema.properties.schema_version.const, "kr.timeline.v1");
});

test("zero-spend policy rejects paid_routes=true", () => {
  const res = KrJobV1Schema.safeParse({
    schema_version: "kr.job.v1",
    job_id: "job_1",
    project_id: "proj_1",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    idempotency_key: "idem_12345678",
    confirmed_by_user: true,
    status: "queued",
    fps: 24,
    sample_rate: 48000,
    zero_spend: { ...DEFAULT_ZERO_SPEND_POLICY, paid_routes: true },
    current_scene_index: 0,
    scenes: [
      {
        scene_id: "sc_1",
        order_index: 0,
        chapter_title: "Ch1",
        title: "Opening",
        location: "Old Library",
        mood: "misty",
        camera_direction: "slow push",
        visual_prompt: "Anime twilight library",
        hi_narration: "यह कहानी एक पुराने पुस्तकालय से शुरू होती है।",
        en_narration: "This story begins inside an old twilight library.",
      },
    ],
    checkpoints: [
      {
        scene_id: "sc_1",
        order_index: 0,
        stage: "queued",
        status: "pending",
        updated_at: "2026-11-22T16:00:00Z",
      },
    ],
    settings: {
      director_route: "deterministic-local-director",
      image_baseline: {
        model_id: "black-forest-labs/FLUX.2-klein-4B",
        model_revision: "e7b7dc27f91deacad38e78976d1f2b499d76a294",
        width: 1344,
        height: 768,
        steps: 4,
        guidance_scale: 1.0,
        grade_profile: "restrained-v1",
        text_encoder: "Qwen3ForCausalLM-NF4-FP32",
      },
      voices: {
        hi: { language: "hi", provider: "edge_tts_free", voice_id: "hi-IN-SwaraNeural", speaking_rate: 1.0 },
        en: { language: "en", provider: "edge_tts_free", voice_id: "en-IN-NeerjaNeural", speaking_rate: 1.0 },
      },
      caption_style: "single_active_lang",
      zero_spend: DEFAULT_ZERO_SPEND_POLICY,
    },
    created_at: "2026-11-22T16:00:00Z",
    updated_at: "2026-11-22T16:00:00Z",
  });
  assert.equal(res.success, false);
});

test("KrTimelineV1Schema accepts valid contiguous timeline", () => {
  const parsed = KrTimelineV1Schema.parse({
    schema_version: "kr.timeline.v1",
    timeline_id: "tl_1",
    project_id: "proj_1",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    version: 1,
    fps: 24,
    sample_rate: 48000,
    total_frames: 192,
    clips: [
      {
        clip_id: "clip_1",
        scene_id: "sc_1",
        label: "Opening",
        in_frame: 0,
        out_frame: 192,
        source_in_frame: 0,
        source_total_frames: 192,
      },
    ],
    stems: [
      { stem_id: "voice_hi", label: "Hindi Voice", gain_db: 0, muted: false, solo: false },
      { stem_id: "voice_en", label: "English Voice", gain_db: 0, muted: false, solo: false },
      { stem_id: "music", label: "Score", gain_db: -8, muted: false, solo: false },
      { stem_id: "sfx", label: "SFX", gain_db: -4, muted: false, solo: false },
      { stem_id: "ambience", label: "Ambience", gain_db: -12, muted: false, solo: false },
    ],
    captions: [
      {
        caption_id: "cap_1",
        scene_id: "sc_1",
        in_frame: 0,
        out_frame: 192,
        hi_text: "शुरुआत",
        en_text: "Beginning",
      },
    ],
    effects: [],
    keyframes: [],
    cuts: [{ cut_id: "cut_1", frame: 192, kind: "scene_boundary" }],
    updated_at: "2026-11-22T16:00:00Z",
  });
  assert.equal(parsed.total_frames, 192);
});
