import assert from "node:assert/strict";
import test from "node:test";
import { decryptWtrBody, fetchWtrChapter, parseWtrChapterUrl } from "./wtr.ts";

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

test("tracker-tainted reader JSON falls back through Codetabs -> AllOrigins -> Jina in order", async () => {
  const target = parseWtrChapterUrl("https://wtr-lab.com/en/novel/27190/the-story/chapter-586");
  assert.ok(target);
  const story = "Ren waited beneath the bridge while the rain washed away every footprint. ".repeat(2);
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/api/chapters/")) return new Response('{"message":"prebid response"}');
    if (url.includes("/api/reader/get")) return new Response('{"content_url":"https://c1.adform.net/cookie"}');
    if (url.includes("api.codetabs.com")) return new Response("unavailable", { status: 502 });
    if (url.includes("api.allorigins.win")) {
      return new Response(
        `<html><title>Debt Returns - WTR-LAB</title><article class="chapter-body"><p>${story}</p><p>The debt remained unpaid.</p></article></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response("jina fallback", { status: 500 });
  };
  try {
    const chapter = await fetchWtrChapter(target);
    assert.ok(chapter);
    assert.equal(chapter.title, "Debt Returns");
    assert.match(chapter.text, /footprint/);
    assert.doesNotMatch(chapter.text, /prebid|adform/i);
    assert.ok(requests.some((url) => url.startsWith("https://api.codetabs.com/v1/proxy?quest=")));
    assert.ok(requests.some((url) => url.startsWith("https://api.allorigins.win/raw?url=")));
    assert.equal(requests.some((url) => url === target.referer), false);
    assert.equal(requests.some((url) => url.includes("c1.adform.net")), false);
    assert.ok(
      requests.findIndex((url) => url.includes("api.codetabs.com")) <
        requests.findIndex((url) => url.includes("api.allorigins.win")),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("connected worker scraping runs first in Agent-Reach order and falls back to Jina Reader when proxies fail", async () => {
  const target = parseWtrChapterUrl("https://wtr-lab.com/en/novel/27190/the-story/chapter-586");
  assert.ok(target);
  const paths: string[] = [];
  const workerUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => new Response("unexpected", { status: 502 });
  try {
    const story = "The worker opened the chapter while the rain covered the bridge. ".repeat(2);
    const chapter = await fetchWtrChapter(target, async (path, url) => {
      paths.push(path);
      workerUrls.push(url);
      return path === "/scrape"
        ? { html: `<html><title>Worker Chapter</title><article><p>${story}</p></article></html>` }
        : null;
    });
    assert.ok(chapter);
    assert.equal(chapter.title, "Worker Chapter");
    assert.match(chapter.text, /worker opened the chapter/);
    assert.deepEqual(paths, ["/api/v1/fetch", "/scrape"]);
    assert.deepEqual(workerUrls, [target.referer, target.referer]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Jina Reader is used as final fallback with X-Return-Format and X-Target-Selector headers", async () => {
  const target = parseWtrChapterUrl("https://wtr-lab.com/en/novel/27190/the-story/chapter-586");
  assert.ok(target);
  const story = "Jina Reader delivered the clean chapter body after proxies failed. ".repeat(2);
  let capturedHeaders: Record<string, string> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://r.jina.ai/")) {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(`Title: Jina Debt\nURL Source: ${target.referer}\n\n${story}`);
    }
    return new Response("unavailable", { status: 502 });
  };
  try {
    const chapter = await fetchWtrChapter(target);
    assert.ok(chapter);
    assert.equal(chapter.title, "Jina Debt");
    assert.match(chapter.text, /Jina Reader delivered/);
    assert.equal(capturedHeaders["X-Return-Format"], "text");
    assert.match(capturedHeaders["X-Target-Selector"] || "", /\.chapter-body/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
