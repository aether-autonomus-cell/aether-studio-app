/** WTR-LAB chapter extraction prefers its JSON API, then clean HTML fallbacks. */

import { hasUnsafeScrapeMarker, htmlToText } from "./extract.ts";

const KEY_TEXT = "IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru";
const WORKER_SCRAPE_PATHS = ["/api/v2/scrape", "/scrape"] as const;

export type WtrTarget = {
  origin: string;
  language: string;
  rawId: string;
  chapterNo: string;
  referer: string;
};

export type WtrWorkerScrape = (
  path: (typeof WORKER_SCRAPE_PATHS)[number],
  url: string,
) => Promise<unknown | null>;

function b64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Chapter bodies are `arr:` / `str:` plus AES-GCM (`iv : tag : ciphertext`, all base64). */
export async function decryptWtrBody(encrypted: string): Promise<string> {
  let payload = encrypted.trim();
  let asArray = false;
  if (payload.startsWith("arr:")) {
    asArray = true;
    payload = payload.slice(4);
  } else if (payload.startsWith("str:")) {
    payload = payload.slice(4);
  } else {
    throw new Error("Unknown chapter format.");
  }
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Invalid chapter payload.");
  const [ivPart, tagPart, dataPart] = parts;
  const iv = b64(ivPart);
  const tag = b64(tagPart);
  const data = b64(dataPart);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(KEY_TEXT), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, concatBytes([data, tag]));
  const decoded = new TextDecoder().decode(plain);
  if (!asArray) return decoded;
  const parsed = JSON.parse(decoded) as unknown;
  if (Array.isArray(parsed)) return parsed.filter((line) => typeof line === "string").join("\n\n");
  return typeof parsed === "string" ? parsed : "";
}

export function parseWtrChapterUrl(raw: string): WtrTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "wtr-lab.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const chapter = [...parts].reverse().find((part) => /^chapter-\d+$/i.test(part));
  if (!chapter) return null;
  const chapterNo = chapter.replace(/^chapter-/i, "");
  const novelAt = parts.findIndex((part) => part.toLowerCase() === "novel");
  let language = "en";
  let rawId = "";
  if (novelAt >= 0 && /^\d+$/.test(parts[novelAt + 1] ?? "")) {
    rawId = parts[novelAt + 1];
    if (novelAt > 0 && /^[a-z]{2}$/i.test(parts[novelAt - 1])) language = parts[novelAt - 1].toLowerCase();
  } else {
    const serie = parts.find((part) => /^serie-\d+$/i.test(part));
    if (!serie) return null;
    rawId = serie.replace(/^serie-/i, "");
    const serieAt = parts.indexOf(serie);
    if (serieAt > 0 && /^[a-z]{2}$/i.test(parts[serieAt - 1])) language = parts[serieAt - 1].toLowerCase();
  }
  return { origin: url.origin, language, rawId, chapterNo, referer: url.toString() };
}

function browserHeaders(referer: string, json: boolean): Headers {
  const headers = new Headers({
    Accept: json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    Referer: referer,
    Origin: new URL(referer).origin,
  });
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

async function readJson(url: string, init: RequestInit): Promise<unknown | null> {
  if (hasUnsafeScrapeMarker(url)) return null;
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20000) });
  } catch {
    return null;
  }
  if (
    !res.ok ||
    (res.status >= 300 && res.status < 400) ||
    hasUnsafeScrapeMarker(`${res.url || url}\n${url}`)
  ) return null;
  try {
    const raw = await res.text();
    if (hasUnsafeScrapeMarker(raw)) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function chapterMeta(
  json: unknown,
  chapterNo: string,
): { id?: number; serie_id?: number; title?: string } | null {
  const stack: unknown[] = [json];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const row = current as Record<string, unknown>;
    const order = row.order ?? row.chapter_no ?? row.chapterNo;
    if (String(order ?? "") === chapterNo && (typeof row.id === "number" || typeof row.chapter_id === "number")) {
      const id = typeof row.id === "number" ? row.id : (row.chapter_id as number);
      const serie = typeof row.serie_id === "number" ? row.serie_id : undefined;
      const title = typeof row.title === "string" ? row.title : typeof row.name === "string" ? row.name : undefined;
      return { id, serie_id: serie, title };
    }
    for (const value of Object.values(row)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

function contentUrlOf(json: unknown): string | null {
  const stack: unknown[] = [json];
  let depth = 0;
  while (stack.length && depth < 400) {
    depth += 1;
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const row = current as Record<string, unknown>;
    if (typeof row.content_url === "string" && row.content_url) return row.content_url;
    for (const value of Object.values(row)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

async function stringsFromBody(body: unknown): Promise<string[]> {
  if (Array.isArray(body)) return body.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  if (typeof body !== "string") return [];
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("arr:") || trimmed.startsWith("str:")) {
    try {
      const decoded = await decryptWtrBody(trimmed);
      return decoded
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith("<")) return [trimmed];
  if (trimmed.length > 40) return [trimmed];
  return [];
}

async function collectChapterText(json: unknown): Promise<{ title: string; lines: string[] }> {
  let title = "";
  const lines: string[] = [];
  const stack: unknown[] = [json];
  let depth = 0;
  while (stack.length && depth < 800) {
    depth += 1;
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      const asLines = await stringsFromBody(current);
      if (asLines.length > 1 && asLines.join("").length > 80) lines.push(...asLines);
      else for (const item of current) stack.push(item);
      continue;
    }
    const row = current as Record<string, unknown>;
    if (!title && typeof row.title === "string" && row.title.trim()) title = row.title.trim();
    for (const key of ["body", "content", "text", "html", "paragraphs"]) {
      if (!(key in row)) continue;
      const pulled = await stringsFromBody(row[key]);
      if (pulled.length) lines.push(...pulled);
    }
    for (const value of Object.values(row)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return { title, lines };
}

export function containsHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

function usableChapterHtml(html: string, pageUrl: string): { title: string; text: string } | null {
  if (hasUnsafeScrapeMarker(pageUrl)) return null;
  const extracted = htmlToText(html);
  if (
    extracted.text.length < 80 ||
    hasUnsafeScrapeMarker(`${extracted.title}\n${extracted.text}`)
  ) {
    return null;
  }
  return extracted;
}

async function readProxyHtml(target: WtrTarget): Promise<{ title: string; text: string } | null> {
  const encoded = encodeURIComponent(target.referer);
  const proxies = [
    `https://api.allorigins.win/raw?url=${encoded}`,
    `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
  ];
  for (const proxyUrl of proxies) {
    let response: Response;
    try {
      response = await fetch(proxyUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" },
      });
    } catch {
      continue;
    }
    if (!response.ok || hasUnsafeScrapeMarker(response.url || proxyUrl)) continue;
    const html = (await response.text()).slice(0, 500_000);
    const chapter = usableChapterHtml(html, response.url || proxyUrl);
    if (chapter) return chapter;
  }
  return null;
}

function workerResponseHtml(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 500_000);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["html", "content", "body", "text"]) {
    if (typeof row[key] === "string") return (row[key] as string).slice(0, 500_000);
  }
  return null;
}

async function readWorkerHtml(target: WtrTarget, scrape: WtrWorkerScrape): Promise<{ title: string; text: string } | null> {
  for (const path of WORKER_SCRAPE_PATHS) {
    const response = await scrape(path, target.referer);
    const html = workerResponseHtml(response);
    if (!html) continue;
    const chapter = usableChapterHtml(html, target.referer);
    if (chapter) return chapter;
  }
  return null;
}

export async function fetchWtrChapter(
  target: WtrTarget,
  workerScrape?: WtrWorkerScrape,
): Promise<{ title: string; text: string } | null> {
  const headers = browserHeaders(target.referer, true);
  const list = await readJson(
    `${target.origin}/api/chapters/${target.rawId}?start=${target.chapterNo}&end=${target.chapterNo}`,
    { method: "GET", headers },
  );
  const meta = list ? chapterMeta(list, target.chapterNo) : null;
  const payloads: Record<string, unknown>[] = [
    {
      translate: "web",
      language: target.language,
      raw_id: Number(target.rawId),
      chapter_no: Number(target.chapterNo),
      retry: false,
      force_retry: false,
    },
  ];
  if (meta?.id) {
    payloads.unshift({
      translate: "web",
      language: target.language,
      raw_id: meta.serie_id ?? Number(target.rawId),
      chapter_no: Number(target.chapterNo),
      chapter_id: meta.id,
      retry: false,
      force_retry: false,
    });
  }
  for (const payload of payloads) {
    let json = await readJson(`${target.origin}/api/reader/get`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!json || typeof json !== "object") continue;
    const row = json as Record<string, unknown>;
    if (row.success === false) continue;
    const remote = contentUrlOf(json);
    if (remote) {
      const next = new URL(remote, target.origin);
      const followed = await readJson(next.toString(), { method: "GET", headers });
      if (followed) json = followed;
    }
    const collected = await collectChapterText(json);
    const text = collected.lines.join("\n\n").trim();
    if (text.length < 80 || hasUnsafeScrapeMarker(`${collected.title}\n${text}`)) continue;
    const title = (meta?.title || collected.title || `Chapter ${target.chapterNo}`).trim();
    if (hasUnsafeScrapeMarker(title)) continue;
    return { title, text };
  }
  const proxied = await readProxyHtml(target);
  if (proxied) return proxied;
  return workerScrape ? readWorkerHtml(target, workerScrape) : null;
}
