import assert from "node:assert/strict";
import test from "node:test";
import { applyChatLook, applyLookPatch, beatsNeedingPrompt, bibleDocument, composeLook, gleanCast, outfitAt, parseStudioAction, textToOutfits } from "./bible.ts";
import { panelHold } from "./timing.ts";
import type { Character } from "./model.ts";

const ren: Character = {
  id: "ren",
  name: "Ren",
  soul: "Pays the debt.",
  vessel: "",
  look: "",
  face: "sharp jaw",
  hair: "half-tied black hair",
  age: "young man",
  scars: "thin scar on the left cheek",
  eyes: "down, refusing the water",
  body: "lean",
  outfit: "torn saffron robe over black",
  outfits: [{ chapter: 420, outfit: "black court robe" }],
};

test("outfit changes at the chapter they are locked, and earlier chapters keep the old clothes", () => {
  assert.equal(outfitAt(ren.outfits, ren.outfit || "", 400), "torn saffron robe over black");
  assert.equal(outfitAt(ren.outfits, ren.outfit || "", 420), "black court robe");
  assert.match(composeLook(ren, 400), /saffron robe/);
  assert.match(composeLook(ren, 420), /black court robe/);
  assert.match(composeLook(ren, 420), /left cheek/);
  assert.match(bibleDocument([ren]), /chapter 420: black court robe/);
});

test("a chat reply can set one look field without inventing a new person", () => {
  const next = applyChatLook(ren, "scars: the scar moved to the right brow");
  assert.equal(next.name, "Ren");
  assert.match(next.scars || "", /right brow/);
  assert.match(next.look, /right brow/);
  assert.equal(next.faceUrl, undefined);
});

test("nearby chapters glean a scar and a later outfit", () => {
  const cast = gleanCast(
    "In chapter 400 Ren wore a torn saffron robe and a thin scar on his left cheek. In chapter 441 Ren wore a black court robe. Shao kept silver hair in a high knot.",
  );
  const locked = cast.find((character) => character.name === "Ren");
  assert.ok(locked);
  assert.match(locked?.scars || locked?.look || "", /scar/i);
  assert.ok((locked?.outfits ?? []).some((row) => row.chapter === 441));
  assert.equal(textToOutfits("441: black court robe")[0]?.chapter, 441);
});

test("picture timing extends only when the new line is longer", () => {
  assert.equal(panelHold(undefined, 3.2), 3.2);
  assert.equal(panelHold(4, 3.2), 4);
  assert.equal(panelHold(4, 6.5), 6.5);
});

test("prompts are still due until a beat is locked, and source panels are skipped", () => {
  assert.deepEqual(
    beatsNeedingPrompt([
      { id: "a", locked: true, promptLocked: false },
      { id: "b", promptLocked: true },
      { id: "c" },
    ]),
    ["c"],
  );
});

test("chat can name a look patch or one spoken line", () => {
  const parsed = parseStudioAction('Left cheek.\nACTION {"type":"look","name":"Ren","scars":"thin scar on the left cheek","outfit":"black court robe","chapter":420}');
  assert.equal(parsed.reply, "Left cheek.");
  assert.equal(parsed.action?.type, "look");
  if (parsed.action?.type !== "look") return;
  const next = applyLookPatch(ren, parsed.action);
  assert.equal(next.scars, "thin scar on the left cheek");
  assert.equal(outfitAt(next.outfits, next.outfit || "", 420), "black court robe");
  assert.equal(next.faceUrl, undefined);
  const line = parseStudioAction('Done.\nACTION {"type":"line","id":"s2","text":"The jade remembered his name."}');
  assert.equal(line.action?.type, "line");
  if (line.action?.type === "line") assert.equal(line.action.text, "The jade remembered his name.");
  assert.equal(parseStudioAction("Just a question.").action, null);
});
