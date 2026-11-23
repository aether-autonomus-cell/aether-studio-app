import test from "node:test";
import assert from "node:assert/strict";
import type { KrStoryBible } from "../contracts/schemas.ts";
import {
  buildTimelineFromStory,
  clampZoomPxPerFrame,
  commitEditorEdit,
  computeScrollLeftForPlayhead,
  computeTrimDeltaFrames,
  createEditorHistory,
  dbToLinearGain,
  detectBilingualSilenceSuggestions,
  exportTimelineSrt,
  frameFromTrackClientX,
  redoEditorHistory,
  rippleDeleteRange,
  splitAtFrame,
  trimClipInEdge,
  trimClipOutEdge,
  undoEditorHistory,
  updateAudioStem,
} from "./index.ts";

const sampleBible: KrStoryBible = {
  project_id: "proj_stepwell",
  title: "Stepwell Echoes",
  logline: "An archivist uncovers glowing Devanagari carvings beneath an ancient stepwell.",
  style_bible: "Restrained twilight anime cinema, warm sandstone and cool indigo shadows.",
  aspect_ratio: "16:9",
  resolution: { width: 1344, height: 768 },
  characters: [
    {
      id: "char_meera",
      name: "Meera",
      role: "Protagonist archivist",
      visual_bible: "Indigo shawl, brass lantern, silver-rimmed glasses",
      hi_voice_profile: "hi-IN-SwaraNeural",
      en_voice_profile: "en-IN-NeerjaNeural",
      continuity_notes: "Carries brass lantern in left hand",
    },
  ],
  world_rules: ["Moonlight reflects upward from stepwell water"],
  scenes: [
    {
      scene_id: "sc_1",
      order_index: 0,
      chapter_title: "Arrival",
      title: "The Dusk Descent",
      location: "Chand Baori twilight steps",
      mood: "mysterious",
      camera_direction: "slow push in",
      visual_prompt: "Anime twilight sandstone stepwell with brass lantern glow",
      negative_prompt: "text, watermark",
      seed: 101,
      hi_narration: "मीरा शाम के धुंधलके में सीढ़ियों से नीचे उतरती है।",
      en_narration: "Meera descends the sandstone steps into quiet dusk.",
      sfx_cues: ["whoosh"],
      ambience_profile: "wind",
      target_duration_sec: 4,
      locked_canon: true,
    },
    {
      scene_id: "sc_2",
      order_index: 1,
      chapter_title: "Discovery",
      title: "The Glowing Glyph",
      location: "Lower water alcove",
      mood: "reverent",
      camera_direction: "wide to medium",
      visual_prompt: "Water reflection illuminating carved wall glyph in anime style",
      negative_prompt: "text, watermark",
      seed: 202,
      hi_narration: "पानी की सतह से टकराकर एक प्राचीन शिलालेख चमक उठता है।",
      en_narration: "Reflected water wakes an ancient inscription on the wall.",
      sfx_cues: ["ding"],
      ambience_profile: "temple_hall",
      target_duration_sec: 4,
      locked_canon: false,
    },
  ],
};

test("editor splits, ripple-deletes across shared tracks, trims, and undoes/redoes atomically", () => {
  const tl = buildTimelineFromStory({
    timeline_id: "tl_1",
    project_id: "proj_stepwell",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: sampleBible,
  });

  assert.equal(tl.clips.length, 2);
  assert.equal(tl.total_frames, 192);

  let hist = createEditorHistory(tl);
  const split = splitAtFrame(hist.present, 48);
  hist = commitEditorEdit(hist, split);
  assert.equal(hist.present.clips.length, 3);
  assert.equal(hist.present.captions.length, 3);
  assert.equal(hist.present.effects.length, 3);

  // Ripple delete [24, 72) => removes 48 frames across clips, captions, effects, cuts
  const rippled = rippleDeleteRange(hist.present, 24, 72);
  hist = commitEditorEdit(hist, rippled);
  assert.equal(hist.present.total_frames, 144);
  assert.equal(hist.present.clips[hist.present.clips.length - 1].out_frame, 144);

  // Trim first clip out edge by -12 frames => total becomes 132
  const trimmed = trimClipOutEdge(hist.present, hist.present.clips[0].clip_id, -12);
  hist = commitEditorEdit(hist, trimmed);
  assert.equal(hist.present.total_frames, 132);

  // Undo back to 144, then 192, then redo back to 144
  hist = undoEditorHistory(hist);
  assert.equal(hist.present.total_frames, 144);
  hist = undoEditorHistory(hist);
  assert.equal(hist.present.total_frames, 192);
  assert.equal(hist.present.clips.length, 3);
  hist = redoEditorHistory(hist);
  assert.equal(hist.present.total_frames, 144);
});

test("bilingual silence detector inspects BOTH HI and EN tracks and stem controls update cleanly", () => {
  const tl = buildTimelineFromStory({
    timeline_id: "tl_2",
    project_id: "proj_stepwell",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: sampleBible,
  });

  // Override clip 0 waveforms: HI silent in middle, EN speaking in middle => NO suggestion in middle!
  // Only silent at tail where BOTH are <= 0.14
  const modified = {
    ...tl,
    clips: tl.clips.map((c, idx) =>
      idx === 0
        ? {
            ...c,
            waveform_hi: [0.8, 0.7, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
            waveform_en: [0.8, 0.7, 0.65, 0.65, 0.65, 0.65, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
          }
        : c,
    ),
  };

  const suggestions = detectBilingualSilenceSuggestions(modified, 0.14, 12);
  const clip0Suggestions = suggestions.filter((s) => s.in_frame < 96);
  assert.ok(clip0Suggestions.length >= 1);
  // Ensure suggestion does NOT start at frame 16 (where EN is still loud!)
  assert.ok(clip0Suggestions[0].in_frame >= 48);

  const muted = updateAudioStem(modified, "music", { gain_db: -18, muted: true });
  const musicStem = muted.stems.find((s) => s.stem_id === "music");
  assert.equal(musicStem?.muted, true);
  assert.equal(musicStem?.gain_db, -18);

  const srtHi = exportTimelineSrt(muted, "hi");
  const srtEn = exportTimelineSrt(muted, "en");
  assert.ok(srtHi.includes("मीरा"));
  assert.ok(srtEn.includes("Meera descends"));
});

test("[UI/EDL] trimClipInEdge adjusts source_in_frame, shifts downstream bilingual tracks, and restores cleanly", () => {
  const tl = buildTimelineFromStory({
    timeline_id: "tl_trim_in",
    project_id: "proj_stepwell",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: sampleBible,
  });

  // Trim first clip in-edge forward by +24f -> duration drops from 96f to 72f, clip 2 shifts to [72, 168)
  const trimmedIn = trimClipInEdge(tl, tl.clips[0].clip_id, 24);
  assert.equal(trimmedIn.clips[0].source_in_frame, 24);
  assert.equal(trimmedIn.clips[0].in_frame, 0);
  assert.equal(trimmedIn.clips[0].out_frame, 72);
  assert.equal(trimmedIn.clips[1].in_frame, 72);
  assert.equal(trimmedIn.clips[1].out_frame, 168);
  assert.equal(trimmedIn.captions[1].in_frame, 72);
  assert.equal(trimmedIn.effects[1].in_frame, 72);
  assert.equal(trimmedIn.total_frames, 168);

  // Dragging left handle back outward (-24f) restores original source_in_frame=0 and total_frames=192
  const restored = trimClipInEdge(trimmedIn, trimmedIn.clips[0].clip_id, -24);
  assert.equal(restored.clips[0].source_in_frame, 0);
  assert.equal(restored.clips[0].out_frame, 96);
  assert.equal(restored.total_frames, 192);
});

test("[UI/EDL] mobile timeline gestures: zoom clamp, scrub frame mapping, horizontal scroll follow, and touch trim deltas", () => {
  assert.equal(clampZoomPxPerFrame(0.1), 0.5);
  assert.equal(clampZoomPxPerFrame(9.0), 4.0);
  assert.equal(clampZoomPxPerFrame(1.5), 1.5);

  // Scrubbing inside a horizontally scrolled 390px viewport at 2.0 px/frame
  const frame = frameFromTrackClientX({
    clientX: 116,
    trackViewportLeft: 16,
    scrollLeft: 80,
    pxPerFrame: 2,
    totalFrames: 192,
    leadingPaddingPx: 16,
  });
  // contentX = (116 - 16) + 80 - 16 = 164px -> 164 / 2 = 82 frames
  assert.equal(frame, 82);

  // Touch trim drag right by +36px at 1.5 px/frame -> +24 frames
  assert.equal(
    computeTrimDeltaFrames({ startClientX: 120, currentClientX: 156, pxPerFrame: 1.5 }),
    24,
  );
  // Touch trim drag left by -18px at 1.5 px/frame -> -12 frames
  assert.equal(
    computeTrimDeltaFrames({ startClientX: 120, currentClientX: 102, pxPerFrame: 1.5 }),
    -12,
  );

  // Horizontal scroll follows playhead when it moves past right edge of a 360px phone track viewport
  const nextScroll = computeScrollLeftForPlayhead({
    playheadFrame: 180,
    pxPerFrame: 2.5,
    viewportWidth: 360,
    currentScrollLeft: 0,
    leadingPaddingPx: 16,
  });
  assert.ok(nextScroll > 0);

  // Gain dB to linear [0..1] conversion respects mute and -48dB floor
  assert.equal(dbToLinearGain(0, false), 1);
  assert.equal(dbToLinearGain(0, true), 0);
  assert.equal(dbToLinearGain(-48, false), 0);
  assert.ok(Math.abs(dbToLinearGain(-6, false) - 0.501) < 0.01);
});

test("[UI/EDL] long bilingual captions (>74 chars) are preserved without truncation in timeline and SRT", () => {
  const longHi =
    "मीरा अपने पीतल के लालटेन के उजाले में चांद बावड़ी की प्राचीन पत्थर की सीढ़ियों से धीरे-धीरे नीचे उतरती है और हर शिलालेख को ध्यान से देखती है।";
  const longEn =
    "Meera carefully descends the weathered sandstone steps of Chand Baori holding her brass lantern high while examining every ancient carving along the shadowy wall.";
  assert.ok(longHi.length > 74);
  assert.ok(longEn.length > 74);

  const longBible: KrStoryBible = {
    ...sampleBible,
    scenes: [
      {
        ...sampleBible.scenes[0],
        hi_narration: longHi,
        en_narration: longEn,
      },
    ],
  };
  const tl = buildTimelineFromStory({
    timeline_id: "tl_long_caps",
    project_id: "proj_stepwell",
    story_revision_id: "srev_1",
    settings_revision_id: "set_1",
    bible: longBible,
  });

  assert.equal(tl.captions[0].hi_text, longHi);
  assert.equal(tl.captions[0].en_text, longEn);
  assert.ok(exportTimelineSrt(tl, "hi").includes(longHi));
  assert.ok(exportTimelineSrt(tl, "en").includes(longEn));
});
