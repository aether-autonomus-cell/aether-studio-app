import test from "node:test";
import assert from "node:assert/strict";
import type { KrSceneCheckpoint, KrStoryBible, KrTimelineClip } from "../contracts/schemas.ts";
import {
  applyMeasuredSilenceTrim,
  buildTimelineFromStory,
  canAutoTrimSilenceSuggestion,
  classifyClipMediaStatus,
  getAudioPlaybackStatusSummary,
} from "./index.ts";

const sampleBible: KrStoryBible = {
  project_id: "proj_media_check",
  title: "Media Lifecycle Test",
  logline: "Verify pending vs available vs validated vs playback_error states.",
  style_bible: "Restrained anime",
  aspect_ratio: "16:9",
  resolution: { width: 1344, height: 768 },
  characters: [
    {
      id: "char_1",
      name: "Meera",
      role: "Lead",
      visual_bible: "Lantern",
      hi_voice_profile: "hi-IN-SwaraNeural",
      en_voice_profile: "en-IN-NeerjaNeural",
      continuity_notes: "",
    },
  ],
  world_rules: [],
  scenes: [
    {
      scene_id: "sc_1",
      order_index: 0,
      chapter_title: "One",
      title: "Scene One",
      location: "Stepwell",
      mood: "calm",
      camera_direction: "static",
      visual_prompt: "Stone steps",
      negative_prompt: "text",
      seed: 1,
      hi_narration: "पहला दृश्य।",
      en_narration: "First scene.",
      sfx_cues: [],
      ambience_profile: "warm_room",
      target_duration_sec: 4,
      locked_canon: true,
    },
  ],
};

function makeBaseClip(): KrTimelineClip {
  return buildTimelineFromStory({
    timeline_id: "tl_media",
    project_id: "proj_media_check",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: sampleBible,
  }).clips[0];
}

test("[ACTUAL-MEDIA] pending state when no URL, Drive ID, or checkpoint exists", () => {
  const clip = makeBaseClip();
  const status = classifyClipMediaStatus(clip, null, {});

  assert.equal(status.picture.state, "pending");
  assert.equal(status.picture.kind, "storyboard");
  assert.equal(status.hiAudio.state, "pending");
  assert.equal(status.enAudio.state, "pending");

  const playback = getAudioPlaybackStatusSummary(status.hiAudio, "hi");
  assert.equal(playback.canAttemptPlayback, false);
  assert.equal(playback.isVerifiedPlayable, false);
  assert.equal(playback.isSilentStoryboard, true);
});

test("[ACTUAL-MEDIA] mere URL or Drive ID presence marks 'available', NEVER 'validated' or playable", () => {
  const clipWithUrlsAndDriveIds: KrTimelineClip = {
    ...makeBaseClip(),
    drive_image_id: "drive_img_123",
    image_url: "https://example.invalid/plate.png",
    hi_audio_url: "https://example.invalid/hi.wav",
    en_audio_url: null,
  };
  const checkpoint: KrSceneCheckpoint = {
    scene_id: "sc_1",
    order_index: 0,
    stage: "ready",
    status: "completed",
    attempt: 1,
    image_drive_id: "drive_img_123",
    image_local_path: null,
    hi_audio_drive_id: "drive_hi_456",
    hi_audio_samples: 192000,
    en_audio_drive_id: "drive_en_789",
    en_audio_samples: 192000,
    composed_mp4_drive_id: null,
    duration_frames: 96,
    verified: true,
    error_code: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  // Without browser load/canplay probe confirmation, URLs & Drive IDs stay 'available' (NOT 'validated')
  const status = classifyClipMediaStatus(clipWithUrlsAndDriveIds, checkpoint, {});
  assert.equal(status.picture.state, "available");
  assert.equal(status.hiAudio.state, "available");
  assert.equal(status.enAudio.state, "available");

  const hiPlayback = getAudioPlaybackStatusSummary(status.hiAudio, "hi");
  assert.equal(hiPlayback.isVerifiedPlayable, false);
  assert.equal(hiPlayback.canAttemptPlayback, true);

  const enDriveOnlyPlayback = getAudioPlaybackStatusSummary(status.enAudio, "en");
  assert.equal(enDriveOnlyPlayback.isVerifiedPlayable, false);
  assert.equal(enDriveOnlyPlayback.canAttemptPlayback, false);
  assert.equal(enDriveOnlyPlayback.isSilentStoryboard, true);
});

test("[ACTUAL-MEDIA] transitions to 'validated' on browser probe success and 'playback_error' on failure", () => {
  const clip: KrTimelineClip = {
    ...makeBaseClip(),
    image_url: "https://example.invalid/plate.png",
    hi_audio_url: "https://example.invalid/hi.wav",
    en_audio_url: "https://example.invalid/en.wav",
  };

  const validated = classifyClipMediaStatus(clip, null, {
    "https://example.invalid/plate.png": "validated",
    "https://example.invalid/hi.wav": "validated",
    "https://example.invalid/en.wav": "playback_error",
  });

  assert.equal(validated.picture.state, "validated");
  assert.equal(validated.hiAudio.state, "validated");
  assert.equal(validated.enAudio.state, "playback_error");

  const hiPlayback = getAudioPlaybackStatusSummary(validated.hiAudio, "hi");
  assert.equal(hiPlayback.isVerifiedPlayable, true);
  assert.equal(hiPlayback.isSilentStoryboard, false);

  const enPlayback = getAudioPlaybackStatusSummary(validated.enAudio, "en");
  assert.equal(enPlayback.isVerifiedPlayable, false);
  assert.equal(enPlayback.canAttemptPlayback, false);
  assert.equal(enPlayback.isSilentStoryboard, true);
});

test("[ACTUAL-MEDIA] silence auto-trim is blocked for demo/pending/available/error audio and allowed only when both HI & EN are validated", () => {
  const base = buildTimelineFromStory({
    timeline_id: "tl_silence_gate",
    project_id: "proj_media_check",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: sampleBible,
  });
  const suggestion = { in_frame: 0, out_frame: 12 };

  // 1. Pending (no URLs) -> blocked
  assert.equal(canAutoTrimSilenceSuggestion(base, suggestion, {}), false);
  assert.throws(() => applyMeasuredSilenceTrim(base, suggestion, {}));

  // 2. URLs present but unprobed ('available') -> blocked
  const withAudioUrls = {
    ...base,
    clips: base.clips.map((c) => ({
      ...c,
      hi_audio_url: "https://example.invalid/hi.wav",
      en_audio_url: "https://example.invalid/en.wav",
    })),
  };
  assert.equal(canAutoTrimSilenceSuggestion(withAudioUrls, suggestion, {}), false);

  // 3. Only HI validated, EN still 'available' -> blocked
  assert.equal(
    canAutoTrimSilenceSuggestion(withAudioUrls, suggestion, {
      "https://example.invalid/hi.wav": "validated",
    }),
    false,
  );

  // 4. Both HI & EN validated -> allowed and ripples cleanly
  const probeBothOk = {
    "https://example.invalid/hi.wav": "validated" as const,
    "https://example.invalid/en.wav": "validated" as const,
  };
  assert.equal(canAutoTrimSilenceSuggestion(withAudioUrls, suggestion, probeBothOk), true);
  const trimmed = applyMeasuredSilenceTrim(withAudioUrls, suggestion, probeBothOk);
  assert.equal(trimmed.total_frames, base.total_frames - 12);
});
