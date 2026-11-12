import assert from "node:assert/strict";
import test from "node:test";
import { deterministicDirection, parseDirection } from "./director.ts";

test("director extracts a valid plan from markdown and surrounding text", () => {
  const parsed = parseDirection(
    'Plan follows:\n```json\n{"title":"A","scenes":[{"caption":"Rain on the bridge."}],"characters":[]}\n```\nDone.',
  );
  assert.equal(parsed?.title, "A");
  assert.equal(parsed?.scenes.length, 1);
});

test("director skips malformed objects and requires at least one usable scene", () => {
  assert.equal(parseDirection('{"wrong": true} then {"scenes":[{"caption":"A beat."}]}')?.scenes.length, 1);
  assert.equal(parseDirection('{"scenes":[{"caption":"","dialogue":""}]}'), null);
});

test("deterministic recovery always returns scenes and a cast from readable source", () => {
  const direction = deterministicDirection(
    "The Lantern Debt\n\nRen wore a torn saffron robe and watched the rain.\n\nRen: I paid the wrong debt.\n\nShao waited with her spear.",
  );
  assert.ok(direction.scenes.length >= 2);
  assert.ok(direction.characters.some((character) => character.name === "Ren"));
});

test("deterministic recovery creates compact beats and complete visual prompts", () => {
  const direction = deterministicDirection(
    `Lantern Debt

${"Ren crossed the rain-soaked bridge while Shao watched from beneath the cedar trees. ".repeat(9)}`,
  );
  assert.ok(direction.scenes.length > 1);
  assert.ok(direction.scenes.every((scene) => {
    const text = [scene.caption, scene.dialogue].filter(Boolean).join(" ");
    const words = text.split(/\s+/).filter(Boolean).length;
    return words <= 25 && scene.imagePrompt.includes("Depict only the described beat:");
  }));
  assert.ok(direction.characters.some((character) => character.name === "Ren"));
  assert.ok(direction.characters.some((character) => character.name === "Shao"));
});
