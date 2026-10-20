import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText, sanitizeNovelText } from "./extract.ts";

test("page text is not clipped at 8000 characters", () => {
  const body = `Rain ${"lantern ".repeat(1600)}`;
  const { title, text } = htmlToText(`<html><title>Bridge</title><p>${body}</p></html>`);
  assert.equal(title, "Bridge");
  assert.ok(text.length > 8000);
  assert.match(text, /lantern/);
});

test("wtr-lab chrome is stripped from pasted chapter text", () => {
  const raw = [
    "WTR-LAB",
    "Ch. 586/616",
    "95.1% Web",
    "#586Chapter",
    "The bridge was empty. Ren did not look at the water.",
    "Next chapter",
    "He said the debt stayed even when the body changed.",
  ].join("\n");
  const clean = sanitizeNovelText(raw);
  assert.doesNotMatch(clean, /WTR-?LAB/i);
  assert.doesNotMatch(clean, /Ch\.\s*586/);
  assert.doesNotMatch(clean, /95\.1%\s*Web/);
  assert.doesNotMatch(clean, /#586Chapter/);
  assert.doesNotMatch(clean, /Next chapter/);
  assert.match(clean, /The bridge was empty/);
  assert.match(clean, /the debt stayed/);
});

test("glued site chrome and html entities do not survive", () => {
  const raw = [
    "WTR-LABNovelCh. 586/61695.1% Web#586Chapter The spear stayed lowered.",
    "Home | Novels | Library | Ranking",
    "He said the debt stayed.",
  ].join("\n");
  const clean = sanitizeNovelText(raw);
  assert.doesNotMatch(clean, /WTR|586\/616|95\.1%|#586|Library|Ranking/i);
  assert.match(clean, /spear stayed lowered/);
  assert.match(clean, /debt stayed/);

  const amp = "&" + "amp;";
  const html = `<html><title>Debt ${amp} Rain - WTR-LAB</title><article><p>The gate ${amp} the spear stayed open.</p><p>Ch. 12/40</p></article></html>`;
  const { title, text } = htmlToText(html);
  assert.doesNotMatch(title, /WTR/i);
  assert.match(title, /Debt & Rain/);
  assert.match(text, /gate & the spear/);
  assert.doesNotMatch(text, /12\/40/);
});

test("short site labels on their own lines are dropped", () => {
  const clean = sanitizeNovelText(["Novel", "Web", "MTL", "The spear stayed lowered.", "Machine translation"].join("\n"));
  assert.equal(clean, "The spear stayed lowered.");
});

test("chapter html drops the site title chrome", () => {
  const html = `<html><title>Chapter 586 - Debt - WTR-LAB</title><nav>WTR-LAB Ch. 586/616</nav><article><p>95.1% Web</p><p>#586Chapter The spear stayed lowered while the gate opened.</p></article></html>`;
  const { title, text } = htmlToText(html);
  assert.doesNotMatch(title, /WTR-?LAB/i);
  assert.doesNotMatch(text, /WTR-?LAB|95\.1%|586\/616|#586Chapter/i);
  assert.match(text, /spear stayed lowered/);
});
