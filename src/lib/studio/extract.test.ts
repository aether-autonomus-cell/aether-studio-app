import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText } from "./extract.ts";

test("page text is not clipped at 8000 characters", () => {
  const body = `Rain ${"lantern ".repeat(1600)}`;
  const { title, text } = htmlToText(`<html><title>Bridge</title><p>${body}</p></html>`);
  assert.equal(title, "Bridge");
  assert.ok(text.length > 8000);
  assert.match(text, /lantern/);
});
