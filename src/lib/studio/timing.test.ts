import assert from "node:assert/strict";
import test from "node:test";
import {
  PCM_SAMPLE_RATE,
  buildTimelineFromSpeech,
  computeCumulativeBoundaries,
  estimateTimelineForJob,
  findSceneAtFrame,
} from "./timing.ts";
import { createDefaultProject } from "./schema.ts";
import { getSafeBox, splitGraphemes, wrapTextMeasured } from "./renderer/typography.ts";

test("computeCumulativeBoundaries matches exact cumulative 48 kHz PCM integer frame math", () => {
  // 2.5s + 3.0s + 1.5s = 7.0s @ 30fps -> [0, 75, 165, 210]
  const samples = [
    Math.round(2.5 * PCM_SAMPLE_RATE),
    Math.round(3.0 * PCM_SAMPLE_RATE),
    Math.round(1.5 * PCM_SAMPLE_RATE),
  ];
  const boundaries = computeCumulativeBoundaries(samples, 30);
  assert.deepEqual(boundaries, [0, 75, 165, 210]);
});

test("buildTimelineFromSpeech adapts visual frame counts independently for HI and EN without drift", () => {
  const hiTimeline = buildTimelineFromSpeech(
    [
      { id: "s1", speechSamples: 192_000, pauseSamples: 14_400 }, // 4.3s
      { id: "s2", speechSamples: 240_000, pauseSamples: 14_400 }, // 5.3s
    ],
    30,
  );
  const enTimeline = buildTimelineFromSpeech(
    [
      { id: "s1", speechSamples: 144_000, pauseSamples: 14_400 }, // 3.3s
      { id: "s2", speechSamples: 192_000, pauseSamples: 14_400 }, // 4.3s
    ],
    30,
  );
  assert.equal(hiTimeline.totalFrames, Math.round(9.6 * 30));
  assert.equal(enTimeline.totalFrames, Math.round(7.6 * 30));
  assert.equal(hiTimeline.scenes[0].startFrame, 0);
  assert.equal(hiTimeline.scenes[1].startFrame, hiTimeline.scenes[0].endFrame);
});

test("findSceneAtFrame maps frames to scenes and silent pauses accurately", () => {
  const job = createDefaultProject();
  const timeline = estimateTimelineForJob(job, "hi-IN");
  const first = findSceneAtFrame(timeline, 0);
  assert.equal(first.scene.id, "s1");
  assert.equal(first.isSpeaking, true);
  assert.ok(first.speechEnvelope > 0);

  const lastFrame = timeline.totalFrames - 1;
  const last = findSceneAtFrame(timeline, lastFrame);
  assert.equal(last.scene.id, "s4");
});

test("Devanagari grapheme splitting preserves vowel matras and pixel wrapping honors maxWidth", () => {
  const hindi = "कहानी शुरू होती है";
  const graphemes = splitGraphemes(hindi, "hi-IN");
  // Must have fewer grapheme clusters than UTF-16 code units because of matras
  assert.ok(graphemes.length < hindi.length);

  const measurer = {
    measureText: (txt: string) => ({ width: splitGraphemes(txt, "hi-IN").length * 14 }),
  };
  const lines = wrapTextMeasured(measurer, hindi, 120, "hi-IN", 2);
  assert.ok(lines.length >= 1 && lines.length <= 2);
  for (const line of lines) {
    assert.ok(measurer.measureText(line).width <= 120);
  }
});

test("getSafeBox enforces 9:16 mobile safe zones (7% L/R, 8% T, 15% B) and 16:9 5%", () => {
  const portrait = getSafeBox(1080, 1920, "9:16");
  assert.equal(portrait.marginLeft, Math.round(1080 * 0.07));
  assert.equal(portrait.marginTop, Math.round(1920 * 0.08));
  assert.equal(portrait.marginBottom, Math.round(1920 * 0.15));

  const landscape = getSafeBox(1920, 1080, "16:9");
  assert.equal(landscape.marginLeft, Math.round(1920 * 0.05));
  assert.equal(landscape.marginBottom, Math.round(1080 * 0.05));
});
