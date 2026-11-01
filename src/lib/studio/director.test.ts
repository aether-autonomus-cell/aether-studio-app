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
