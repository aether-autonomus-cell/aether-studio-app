import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK_CHARS, chunkChapterText, expandChapterUrls } from "./range.ts";

test("a template with {n} expands one url per chapter", () => {
  assert.deepEqual(expandChapterUrls("https://example.com/book/{n}", 2, 4), [
    "https://example.com/book/2",
    "https://example.com/book/3",
    "https://example.com/book/4",
  ]);
});

test("start-end replaces the last number when {n} is absent", () => {
  assert.deepEqual(expandChapterUrls("https://example.com/2024/chapter/10", 10, 11), [
    "https://example.com/2024/chapter/10",
    "https://example.com/2024/chapter/11",
  ]);
});

test("a range over forty chapters is refused", () => {
  assert.throws(() => expandChapterUrls("https://example.com/{n}", 1, 41), /40/);
});

test("long text is chunked without dropping the ending", () => {
  const text = Array.from({ length: 24 }, (_, index) => `Paragraph ${index} ${"word ".repeat(90)}`).join("\n\n");
  const chunks = chunkChapterText(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= CHUNK_CHARS));
  assert.match(chunks[0], /Paragraph 0/);
  assert.match(chunks[chunks.length - 1], /Paragraph 23/);
});
