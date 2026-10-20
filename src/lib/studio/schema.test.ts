import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE, jobPacket } from "./model.ts";
import { jobPacketV2Schema } from "./schema.ts";

test("sample export is job packet v2", () => {
  const packet = jobPacket(SAMPLE);
  const parsed = jobPacketV2Schema.parse(packet);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.language, "en");
  assert.equal(parsed.voice, "en-IN-PrabhatNeural");
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.chapters[0].scenes.length, 4);
  const opening = parsed.chapters[0].scenes[0];
  assert.equal(opening.bubble.speaker, "Ren");
  assert.match(opening.bubble.text, /pendant/);
  assert.equal(opening.tiles[0].vessel_id, "ren");
  assert.ok(opening.tiles[0].characters.includes("ren"));
  assert.ok(opening.tiles[0].negative.length > 0);
  assert.ok(opening.tiles[0].prompt.length > 10);
  const shao = parsed.chapters[0].scenes[2];
  assert.equal(shao.bubble.speaker, "Shao");
  assert.equal(shao.tiles[0].vessel_id, "shao");
  assert.equal(parsed.chapters[0].scenes[1].sfx, "CRACK");
  assert.equal(Object.hasOwn(parsed.seo, "privacy"), false);
  assert.equal(parsed.seo.title, SAMPLE.seo.title);
});

test("hindi text selects the hindi male voice", () => {
  const packet = jobPacket({
    ...SAMPLE,
    text: "रेन पुल पर खड़ा था। उसने कहा कि कर्ज चुकाना है।",
    narration: "रेन पुल पर खड़ा था।",
  });
  assert.equal(packet.language, "hi");
  assert.equal(packet.voice, "hi-IN-MadhurNeural");
});

test("youtube privacy stays off the job packet", () => {
  const packet = jobPacket({ ...SAMPLE, seo: { ...SAMPLE.seo, privacy: "unlisted" } });
  assert.equal(Object.hasOwn(packet.seo, "privacy"), false);
  assert.deepEqual(packet.seo.tags, SAMPLE.seo.tags);
});

test("schema rejects a language outside hi/en", () => {
  const packet = jobPacket(SAMPLE);
  const broken = { ...packet, language: "fr" };
  assert.equal(jobPacketV2Schema.safeParse(broken).success, false);
});
