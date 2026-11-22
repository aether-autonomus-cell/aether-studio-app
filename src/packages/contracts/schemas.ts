import { z } from "zod";
import { KR_FPS, KR_SAMPLE_RATE } from "./timing.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Strict Zero-Spend Policy (Server-Enforced)
// ──────────────────────────────────────────────────────────────────────────────

export const FREE_ROUTE_ALLOWLIST = [
  "colab-free-gpu",
  "local-studio-preview",
  "google-gemini-free-tier",
  "groq-free-tier",
  "openrouter-free-tier",
  "deterministic-local-director",
] as const;

export type FreeRouteId = (typeof FREE_ROUTE_ALLOWLIST)[number];

export const ZeroSpendPolicySchema = z.object({
  paid_routes: z.literal(false),
  allow_billing_fallback: z.literal(false),
  allowed_free_routes: z.array(z.enum(FREE_ROUTE_ALLOWLIST)).min(1),
  pause_on_quota_exhaustion: z.literal(true),
});

export type ZeroSpendPolicy = z.infer<typeof ZeroSpendPolicySchema>;

export const DEFAULT_ZERO_SPEND_POLICY: ZeroSpendPolicy = {
  paid_routes: false,
  allow_billing_fallback: false,
  allowed_free_routes: [...FREE_ROUTE_ALLOWLIST],
  pause_on_quota_exhaustion: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Story Bible, Canon & Structured Revisions / Patches
// ──────────────────────────────────────────────────────────────────────────────

export const KrCharacterCanonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  visual_bible: z.string().min(1),
  hi_voice_profile: z.string().min(1),
  en_voice_profile: z.string().min(1),
  continuity_notes: z.string().default(""),
});

export type KrCharacterCanon = z.infer<typeof KrCharacterCanonSchema>;

export const KrStorySceneSchema = z.object({
  scene_id: z.string().min(1),
  order_index: z.number().int().min(0),
  chapter_title: z.string().min(1),
  title: z.string().min(1),
  location: z.string().min(1),
  mood: z.string().min(1),
  camera_direction: z.string().min(1),
  visual_prompt: z.string().min(1),
  negative_prompt: z.string().default("text, watermark, signature, low quality, blurry, deformed"),
  seed: z.number().int().min(0).default(104729),
  hi_narration: z.string().min(1),
  en_narration: z.string().min(1),
  sfx_cues: z.array(z.enum(["whoosh", "thump", "rumble", "crash", "creak", "ding", "pop"])).default([]),
  ambience_profile: z.enum(["none", "rain", "wind", "temple_hall", "night_forest", "warm_room"]).default("warm_room"),
  target_duration_sec: z.number().min(2).max(60).default(8),
  locked_canon: z.boolean().default(false),
});

export type KrStoryScene = z.infer<typeof KrStorySceneSchema>;

export const KrStoryBibleSchema = z.object({
  project_id: z.string().min(1),
  title: z.string().min(1),
  logline: z.string().min(1),
  style_bible: z.string().min(1),
  aspect_ratio: z.literal("16:9").default("16:9"),
  resolution: z.object({
    width: z.literal(1344),
    height: z.literal(768),
  }),
  characters: z.array(KrCharacterCanonSchema).min(1),
  world_rules: z.array(z.string()).default([]),
  scenes: z.array(KrStorySceneSchema).min(1),
});

export type KrStoryBible = z.infer<typeof KrStoryBibleSchema>;

export const KrStoryPatchOperationSchema = z.object({
  op_id: z.string().min(1),
  op: z.enum(["update_scene", "insert_scene", "update_bible", "update_character"]),
  target_id: z.string().min(1),
  field_path: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
  rationale: z.string().min(1),
});

export type KrStoryPatchOperation = z.infer<typeof KrStoryPatchOperationSchema>;

export const KrStoryPatchSchema = z.object({
  patch_id: z.string().min(1),
  project_id: z.string().min(1),
  base_story_revision_id: z.string().min(1),
  status: z.enum(["pending", "accepted", "rejected", "rebased"]),
  summary: z.string().min(1),
  operations: z.array(KrStoryPatchOperationSchema).min(1),
  created_at: z.string().min(1),
});

export type KrStoryPatch = z.infer<typeof KrStoryPatchSchema>;

export const KrStoryRevisionSchema = z.object({
  revision_id: z.string().min(1),
  project_id: z.string().min(1),
  version: z.number().int().min(1),
  parent_revision_id: z.string().nullable(),
  summary: z.string().min(1),
  content_sha256: z.string().min(16),
  bible: KrStoryBibleSchema,
  created_at: z.string().min(1),
});

export type KrStoryRevision = z.infer<typeof KrStoryRevisionSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Settings Revision (Model/Voice/Quality/Route Configuration)
// ──────────────────────────────────────────────────────────────────────────────

export const KrVoiceConfigSchema = z.object({
  language: z.enum(["hi", "en"]),
  provider: z.enum(["edge_tts_free", "chatterbox_colab", "indic_parler_colab", "browser_speech_preview"]),
  voice_id: z.string().min(1),
  speaking_rate: z.number().min(0.75).max(1.35).default(1.0),
});

export const KrSettingsSnapshotSchema = z.object({
  director_route: z.enum(FREE_ROUTE_ALLOWLIST).default("deterministic-local-director"),
  image_baseline: z.object({
    model_id: z.literal("black-forest-labs/FLUX.2-klein-4B"),
    model_revision: z.literal("e7b7dc27f91deacad38e78976d1f2b499d76a294"),
    width: z.literal(1344),
    height: z.literal(768),
    steps: z.number().int().min(1).max(8).default(4),
    guidance_scale: z.number().min(0.5).max(3.0).default(1.0),
    grade_profile: z.literal("restrained-v1"),
    text_encoder: z.literal("Qwen3ForCausalLM-NF4-FP32"),
  }),
  voices: z.object({
    hi: KrVoiceConfigSchema,
    en: KrVoiceConfigSchema,
  }),
  caption_style: z.enum(["bilingual_lower", "single_active_lang", "minimal_cinema"]).default("single_active_lang"),
  zero_spend: ZeroSpendPolicySchema,
  drive_export_folder_id: z.string().default("15ek6wQirJz7d0DCLf6fvFWtMRvWpcLHx"),
});

export type KrSettingsSnapshot = z.infer<typeof KrSettingsSnapshotSchema>;

export const KrSettingsRevisionSchema = z.object({
  settings_revision_id: z.string().min(1),
  project_id: z.string().min(1),
  version: z.number().int().min(1),
  snapshot: KrSettingsSnapshotSchema,
  created_at: z.string().min(1),
});

export type KrSettingsRevision = z.infer<typeof KrSettingsRevisionSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// kr.job.v1 — Scene-by-Scene Waterfall Production Contract
// ──────────────────────────────────────────────────────────────────────────────

export const KR_SCENE_STAGES = [
  "queued",
  "image",
  "speech_hi",
  "speech_en",
  "timing",
  "compose",
  "verify",
  "drive_save",
  "ready",
  "timeline_append",
  "failed",
] as const;

export type KrSceneStage = (typeof KR_SCENE_STAGES)[number];

export const KrSceneCheckpointSchema = z.object({
  scene_id: z.string().min(1),
  order_index: z.number().int().min(0),
  stage: z.enum(KR_SCENE_STAGES),
  status: z.enum(["pending", "running", "completed", "blocked", "failed"]),
  attempt: z.number().int().min(0).default(0),
  image_drive_id: z.string().nullable().default(null),
  image_local_path: z.string().nullable().default(null),
  hi_audio_drive_id: z.string().nullable().default(null),
  hi_audio_samples: z.number().int().min(0).default(0),
  en_audio_drive_id: z.string().nullable().default(null),
  en_audio_samples: z.number().int().min(0).default(0),
  composed_mp4_drive_id: z.string().nullable().default(null),
  duration_frames: z.number().int().min(0).default(0),
  verified: z.boolean().default(false),
  error_code: z.string().nullable().default(null),
  error_message: z.string().nullable().default(null),
  updated_at: z.string().min(1),
});

export type KrSceneCheckpoint = z.infer<typeof KrSceneCheckpointSchema>;

export const KrJobStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "paused_quota",
  "paused_user",
  "failed",
  "completed",
  "cancelled",
]);

export type KrJobStatus = z.infer<typeof KrJobStatusSchema>;

export const KrJobV1Schema = z.object({
  schema_version: z.literal("kr.job.v1"),
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  story_revision_id: z.string().min(1),
  settings_revision_id: z.string().min(1),
  idempotency_key: z.string().min(8),
  confirmed_by_user: z.literal(true),
  status: KrJobStatusSchema,
  fps: z.literal(KR_FPS),
  sample_rate: z.literal(KR_SAMPLE_RATE),
  zero_spend: ZeroSpendPolicySchema,
  lease_token: z.string().nullable().default(null),
  lease_expires_at: z.string().nullable().default(null),
  worker_session_id: z.string().nullable().default(null),
  current_scene_index: z.number().int().min(0).default(0),
  scenes: z.array(KrStorySceneSchema).min(1),
  checkpoints: z.array(KrSceneCheckpointSchema).min(1),
  settings: KrSettingsSnapshotSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type KrJobV1 = z.infer<typeof KrJobV1Schema>;

// ──────────────────────────────────────────────────────────────────────────────
// kr.timeline.v1 — Non-Destructive Editor Timeline Contract
// ──────────────────────────────────────────────────────────────────────────────

export const KrTimelineClipSchema = z.object({
  clip_id: z.string().min(1),
  scene_id: z.string().min(1),
  label: z.string().min(1),
  /** Half-open frame interval [in_frame, out_frame) on the master timeline. */
  in_frame: z.number().int().min(0),
  out_frame: z.number().int().min(1),
  /** Source offset in frames from the start of the underlying scene media. */
  source_in_frame: z.number().int().min(0).default(0),
  /** Total source media duration in frames. */
  source_total_frames: z.number().int().min(1),
  /** Picture asset references (Drive file ID + optional inline SVG/preview poster). */
  image_url: z.string().nullable().default(null),
  video_url: z.string().nullable().default(null),
  drive_image_id: z.string().nullable().default(null),
  drive_mp4_id: z.string().nullable().default(null),
  hi_audio_url: z.string().nullable().default(null),
  en_audio_url: z.string().nullable().default(null),
  hi_audio_samples: z.number().int().min(0).default(0),
  en_audio_samples: z.number().int().min(0).default(0),
  /** Deterministic waveform energy envelope (0..1 per bin) for both languages. */
  waveform_hi: z.array(z.number().min(0).max(1)).default([]),
  waveform_en: z.array(z.number().min(0).max(1)).default([]),
});

export type KrTimelineClip = z.infer<typeof KrTimelineClipSchema>;

export const KrAudioStemSchema = z.object({
  stem_id: z.enum(["voice_hi", "voice_en", "music", "sfx", "ambience"]),
  label: z.string().min(1),
  gain_db: z.number().min(-48).max(12).default(0),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
});

export type KrAudioStem = z.infer<typeof KrAudioStemSchema>;

export const KrCaptionEventSchema = z.object({
  caption_id: z.string().min(1),
  scene_id: z.string().min(1),
  in_frame: z.number().int().min(0),
  out_frame: z.number().int().min(1),
  hi_text: z.string().min(1),
  en_text: z.string().min(1),
});

export type KrCaptionEvent = z.infer<typeof KrCaptionEventSchema>;

export const KrEffectSpanSchema = z.object({
  effect_id: z.string().min(1),
  scene_id: z.string().min(1),
  type: z.enum(["ken_burns_push", "ken_burns_pull", "pan_left", "pan_right", "fade_in", "fade_out", "restrained_v1"]),
  in_frame: z.number().int().min(0),
  out_frame: z.number().int().min(1),
  intensity: z.number().min(0).max(1).default(0.35),
});

export type KrEffectSpan = z.infer<typeof KrEffectSpanSchema>;

export const KrKeyframeSchema = z.object({
  keyframe_id: z.string().min(1),
  scene_id: z.string().min(1),
  frame: z.number().int().min(0),
  property: z.enum(["zoom", "pan_x", "pan_y", "opacity"]),
  value: z.number(),
  easing: z.enum(["linear", "ease_in_out", "ease_out"]).default("ease_in_out"),
});

export type KrKeyframe = z.infer<typeof KrKeyframeSchema>;

export const KrCutMarkerSchema = z.object({
  cut_id: z.string().min(1),
  frame: z.number().int().min(0),
  kind: z.enum(["scene_boundary", "manual_split", "ripple_trim"]),
});

export type KrCutMarker = z.infer<typeof KrCutMarkerSchema>;

export const KrSilenceSuggestionSchema = z.object({
  suggestion_id: z.string().min(1),
  in_frame: z.number().int().min(0),
  out_frame: z.number().int().min(1),
  hi_peak_db: z.number(),
  en_peak_db: z.number(),
  reason: z.string().min(1),
  applied: z.boolean().default(false),
});

export type KrSilenceSuggestion = z.infer<typeof KrSilenceSuggestionSchema>;

export const KrTimelineV1Schema = z.object({
  schema_version: z.literal("kr.timeline.v1"),
  timeline_id: z.string().min(1),
  project_id: z.string().min(1),
  story_revision_id: z.string().min(1),
  settings_revision_id: z.string().min(1),
  version: z.number().int().min(1),
  fps: z.literal(KR_FPS),
  sample_rate: z.literal(KR_SAMPLE_RATE),
  active_audio_lang: z.enum(["hi", "en"]).default("hi"),
  active_caption_lang: z.enum(["hi", "en", "both", "off"]).default("both"),
  total_frames: z.number().int().min(0),
  clips: z.array(KrTimelineClipSchema),
  stems: z.array(KrAudioStemSchema).min(5),
  captions: z.array(KrCaptionEventSchema),
  effects: z.array(KrEffectSpanSchema),
  keyframes: z.array(KrKeyframeSchema),
  cuts: z.array(KrCutMarkerSchema),
  silence_suggestions: z.array(KrSilenceSuggestionSchema).default([]),
  updated_at: z.string().min(1),
});

export type KrTimelineV1 = z.infer<typeof KrTimelineV1Schema>;

// ──────────────────────────────────────────────────────────────────────────────
// Skill Trace & Worker Events
// ──────────────────────────────────────────────────────────────────────────────

export const KrSkillTraceEntrySchema = z.object({
  trace_id: z.string().min(1),
  skill_id: z.string().min(1),
  tool_name: z.string().min(1),
  status: z.enum(["ok", "rejected", "blocked_licence", "unavailable"]),
  duration_ms: z.number().int().min(0),
  input_summary: z.record(z.string(), z.unknown()),
  output_summary: z.record(z.string(), z.unknown()),
  created_at: z.string().min(1),
});

export type KrSkillTraceEntry = z.infer<typeof KrSkillTraceEntrySchema>;

export const KrWorkerEventSchema = z.object({
  event_id: z.string().min(1),
  job_id: z.string().min(1),
  worker_session_id: z.string().min(1),
  seq: z.number().int().min(1),
  scene_id: z.string().nullable().default(null),
  stage: z.enum(KR_SCENE_STAGES),
  level: z.enum(["info", "warn", "error"]),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().min(1),
});

export type KrWorkerEvent = z.infer<typeof KrWorkerEventSchema>;
