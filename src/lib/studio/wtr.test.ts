import assert from "node:assert/strict";
import test from "node:test";
import { decryptWtrBody, parseWtrChapterUrl } from "./wtr.ts";

test("a chapter link is recognised without treating the novel home as a chapter", () => {
  const chapter = parseWtrChapterUrl("https://wtr-lab.com/en/novel/27190/the-story/chapter-586");
  assert.equal(chapter?.rawId, "27190");
  assert.equal(chapter?.chapterNo, "586");
  assert.equal(chapter?.language, "en");
  assert.equal(parseWtrChapterUrl("https://wtr-lab.com/en/novel/27190/the-story"), null);
  const serie = parseWtrChapterUrl("https://www.wtr-lab.com/en/serie-88/fable/chapter-3");
  assert.equal(serie?.rawId, "88");
  assert.equal(serie?.chapterNo, "3");
});

test("aes chapter bodies round-trip", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = JSON.stringify(["The bridge was empty.", "The debt stayed."]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const tag = sealed.slice(sealed.length - 16);
  const data = sealed.slice(0, sealed.length - 16);
  const pack = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  const token = `arr:${pack(iv)}:${pack(tag)}:${pack(data)}`;
  const text = await decryptWtrBody(token);
  assert.match(text, /bridge was empty/);
  assert.match(text, /debt stayed/);
});
