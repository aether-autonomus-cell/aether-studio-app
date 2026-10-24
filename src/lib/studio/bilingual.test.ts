import assert from "node:assert/strict";
import test from "node:test";
import { missingScript, rememberScript, samePictures, srtFor, withLanguage, writeTranslated } from "./bilingual.ts";
import { SAMPLE, type Project } from "./model.ts";

test("switching to Hindi keeps every picture and every image prompt", () => {
  const hindi = withLanguage(SAMPLE, "hi");
  assert.equal(samePictures(SAMPLE, hindi), true);
  assert.match(hindi.scenes[0]?.dialogue ?? "", /क़र्ज़/);
  assert.match(hindi.narration, /रूह/);
  assert.match(hindi.seo.title, /क़र्ज़/);
  assert.equal(hindi.scenes[0]?.imageUrl, "/panels/01-bridge.jpg");
});

test("switching back to English restores the English script and the same frames", () => {
  const round = withLanguage(withLanguage(SAMPLE, "hi"), "en");
  assert.equal(round.scenes[0]?.dialogue, SAMPLE.scenes[0]?.dialogue);
  assert.equal(samePictures(SAMPLE, round), true);
  assert.equal(missingScript(SAMPLE, "hi").length, 0);
  assert.equal(missingScript(SAMPLE, "en").length, 0);
});

test("a fresh cut remembers English and can take a Hindi line without a new prompt", () => {
  const cut = rememberScript(
    {
      ...SAMPLE,
      scenes: SAMPLE.scenes.map((scene) => ({
        ...scene,
        lineEn: undefined,
        lineHi: undefined,
        captionEn: undefined,
        captionHi: undefined,
        dialogueEn: undefined,
        dialogueHi: undefined,
      })),
      narrationEn: undefined,
      narrationHi: undefined,
      seoEn: undefined,
      seoHi: undefined,
    },
    "en",
  );
  assert.equal(missingScript(cut, "en").length, 0);
  assert.ok(missingScript(cut, "hi").length > 0);
  const filled = writeTranslated(cut, "hi", [
    { id: "s1", caption: "हिंदी कैप्शन", dialogue: "हिंदी संवाद" },
  ]);
  const shown = withLanguage(filled, "hi");
  assert.equal(shown.scenes[0]?.dialogue, "हिंदी संवाद");
  assert.equal(shown.scenes[0]?.imagePrompt, SAMPLE.scenes[0]?.imagePrompt);
  assert.equal(shown.scenes[1]?.imageUrl, SAMPLE.scenes[1]?.imageUrl);
});

test("a Hindi caption file does not change the pictures", () => {
  const srt = srtFor(SAMPLE, "hi");
  assert.match(srt, /1\n00:00:00,000 -->/);
  assert.match(srt, /क़र्ज़/);
  assert.equal(srt.includes("imagePrompt"), false);
  assert.equal(samePictures(SAMPLE, withLanguage(SAMPLE, "hi")), true);
});

test("picture identity survives a project that has no Hindi yet", () => {
  const bare: Project = {
    ...SAMPLE,
    scenes: [SAMPLE.scenes[0]!],
    narrationHi: undefined,
    seoHi: undefined,
  };
  const next = withLanguage(bare, "en");
  assert.equal(samePictures(bare, next), true);
});
