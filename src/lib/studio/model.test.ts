import assert from "node:assert/strict";
import test from "node:test";
import { cutChapter, dialogueWithoutSpeaker, jobPacket, mergeCuts, projectFromChapters } from "./model.ts";
import { jobPacketV2Schema } from "./schema.ts";

test("phone cut keeps more than six scenes and the full narration", () => {
  const spoken = Array.from({ length: 7 }, (_, index) => `Person${index + 1}: ${"debt ".repeat(30).trim()}`);
  const project = cutChapter(["Seven Speakers", ...spoken].join("\n"));
  assert.equal(project.scenes.length, 7);
  assert.ok(project.narration.length > 700);
  assert.equal(project.scenes[6].speaker, "Person7");
});

test("a chapter range becomes one v2 packet with a chapter each", () => {
  const project = projectFromChapters([
    {
      index: 3,
      title: "Bridge",
      sourceUrl: "https://example.com/3",
      text: "Rain argued with the lanterns while Ren kept his eyes on the stone and not the water below the rail.",
    },
    {
      index: 4,
      title: "Gate",
      sourceUrl: "https://example.com/4",
      text: "Lightning opened the palace gate. Shao kept the spear lowered and said the body could not cross.",
    },
  ]);
  assert.equal(project.chapters?.length, 2);
  assert.equal(project.scenes.length, 2);
  assert.equal(project.scenes[0].id, "c3-s1");
  const packet = jobPacketV2Schema.parse(jobPacket(project));
  assert.equal(packet.chapters.length, 2);
  assert.equal(packet.chapters[0].index, 3);
  assert.equal(packet.chapters[0].source_url, "https://example.com/3");
  assert.equal(packet.chapters[1].scenes[0].tiles[0].prompt.length > 10, true);
});

test("the speaker chip is not repeated inside the bubble", () => {
  assert.equal(
    dialogueWithoutSpeaker({ speaker: "Ren", dialogue: "Ren: The pendant cracked because I paid the wrong debt." }),
    "The pendant cracked because I paid the wrong debt.",
  );
  assert.equal(dialogueWithoutSpeaker({ speaker: "Ren", dialogue: "The pendant cracked." }), "The pendant cracked.");
  assert.equal(dialogueWithoutSpeaker({ speaker: "", dialogue: "Ren: still spoken." }), "Ren: still spoken.");
});
test("direction chunks merge instead of keeping only the first cut", () => {
  const make = (n: number) =>
    cutChapter(`Part ${n}\n\n${"Rain on the bridge. ".repeat(20)}\n\nRen: The debt stays.`);
  const merged = mergeCuts([make(1), make(2)]);
  assert.ok(merged.scenes.length > 2);
  assert.equal(merged.chapters, undefined);
});
