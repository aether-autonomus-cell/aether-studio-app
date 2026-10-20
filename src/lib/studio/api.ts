import { createServerFn } from "@tanstack/react-start";
import type { AiProvider } from "@/lib/studio/config";
import { studioConfig } from "@/lib/studio/config";
import { htmlToText } from "@/lib/studio/extract";
import { assertJobId, jobResourcePath, parseJobStatus, readJobId, type JobSnapshot } from "@/lib/studio/jobs";
import type { Character, Scene, Seo } from "@/lib/studio/model";
import { detectLanguage, jobPacketV2Schema, voiceFor } from "@/lib/studio/schema";
import { workerEndpoint, type WorkerPath } from "@/lib/studio/worker";

type Direction = {
  title: string;
  logline: string;
  timeline: string[];
  characters: Character[];
  scenes: Scene[];
  narration: string;
  seo: Seo;
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function readProvider(input: unknown): { provider: AiProvider; workerUrl: string; workerToken: string } {
  const row = input as { provider?: unknown; workerUrl?: unknown; workerToken?: unknown };
  const workerToken = typeof row?.workerToken === "string" ? row.workerToken : "";
  if (workerToken.length > 500) throw new Error("That token is too long.");
  return {
    provider: row?.provider === "worker" ? "worker" : "gemini",
    workerUrl: typeof row?.workerUrl === "string" ? row.workerUrl : "",
    workerToken,
  };
}

function geminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key || null;
}

const DIRECTOR_SYSTEM =
  "You direct an original motion comic. Return only JSON. Separate soul (identity, choices) from vessel (the current body). If a body changes, keep the soul and describe the new vessel. Include every beat in this excerpt as its own scene. Do not stop at 4 or 6 scenes and do not drop the ending. imagePrompt is a vertical illustrated panel with no text, letters, logos, or speech bubbles. sfx is one short word or empty. narration reads this excerpt in order. No markdown.";

async function geminiText(apiKey: string, system: string, user: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${studioConfig.geminiModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      },
    );
  } catch {
    return { ok: false, error: "Gemini did not answer." };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `Gemini could not finish that call (${res.status}).` };
  let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false, error: "Gemini returned a plan this studio could not read." };
  }
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
  if (!text.trim()) return { ok: false, error: "Gemini returned an empty plan." };
  return { ok: true, text };
}

async function workerPost(
  path: WorkerPath,
  url: string,
  token: string,
  payload: unknown,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  let target: URL;
  try {
    target = workerEndpoint(url, path);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That worker URL is not valid." };
  }
  const blocked = await assertPublic(target.hostname);
  if (blocked) return { ok: false, error: blocked };
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Aether-Token": token,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "The worker did not answer." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, error: "The worker redirected. Nothing was sent." };
  const raw = (await res.text()).split(token).join("[redacted]");
  if (!res.ok) return { ok: false, error: raw.slice(0, 280) || `Worker returned ${res.status}.` };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: true, json: raw };
  }
}

export const providerStatus = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async () => ({
    geminiConfigured: Boolean(geminiKey()),
    geminiModel: studioConfig.geminiModel,
    geminiImageModel: studioConfig.geminiImageModel,
    xaiEnabled: studioConfig.xaiEnabled,
  }));

export const directChapter = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const text = typeof (input as { text?: unknown })?.text === "string" ? (input as { text: string }).text.trim() : "";
    if (text.length < 40) throw new Error("Paste at least a short chapter.");
    if (text.length > 9000) throw new Error("That chunk is too long. The studio splits a long chapter before asking.");
    return { text, ...readProvider(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; direction: Direction } | { ok: false; error: string }> => {
    let content = "";
    if (data.provider === "worker") {
      const result = await workerPost("/api/v1/direct", data.workerUrl, data.workerToken, {
        text: data.text,
        language: detectLanguage(data.text),
      });
      if (!result.ok) return result;
      content = typeof result.json === "string" ? result.json : JSON.stringify(result.json);
    } else {
      const apiKey = geminiKey();
      if (!apiKey) {
        return { ok: false, error: "Gemini is not configured. The key stays in the server environment. Phone cut still works." };
      }
      const result = await geminiText(apiKey, DIRECTOR_SYSTEM, data.text);
      if (!result.ok) return result;
      content = result.text;
    }
    const direction = parseDirection(content);
    if (!direction) return { ok: false, error: "The director returned a plan this studio could not read." };
    if (!direction.narration) {
      direction.narration = direction.scenes
        .map((scene) => [scene.caption, scene.dialogue].filter(Boolean).join(" "))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return { ok: true, direction };
  });

export const paintPanel = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const prompt = typeof (input as { prompt?: unknown })?.prompt === "string" ? (input as { prompt: string }).prompt.trim() : "";
    if (prompt.length < 8) throw new Error("That panel has no picture note.");
    return { prompt: prompt.slice(0, 700), ...readProvider(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    const painted = `Vertical manhua comic panel, fictional illustration, no text, no letters, no watermark, no speech bubbles, no logos. ${data.prompt}`;
    if (data.provider === "worker") {
      const result = await workerPost("/api/v1/paint", data.workerUrl, data.workerToken, {
        prompt: painted,
        negative: "text, letters, logos, watermark, speech bubbles",
      });
      if (!result.ok) return result;
      const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
      if (typeof row.url === "string" && row.url) return { ok: true, url: row.url };
      if (typeof row.imageBase64 === "string" && row.imageBase64) {
        const mime = typeof row.mimeType === "string" ? row.mimeType : "image/png";
        return { ok: true, url: `data:${mime};base64,${row.imageBase64}` };
      }
      return { ok: false, error: "The worker returned no image." };
    }
    const apiKey = geminiKey();
    if (!apiKey) return { ok: false, error: "Gemini is not configured. The key stays in the server environment." };
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${studioConfig.geminiImageModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: painted }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
      );
    } catch {
      return { ok: false, error: "Gemini did not answer." };
    }
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `Gemini could not paint that panel (${res.status}).` };
    let body: { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return { ok: false, error: "Gemini returned a picture this studio could not read." };
    }
    const image = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!image?.data) return { ok: false, error: "The painter returned no image." };
    return { ok: true, url: `data:${image.mimeType || "image/png"};base64,${image.data}` };
  });

export const speakLine = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { text?: unknown; voice?: unknown };
    const text = typeof row?.text === "string" ? row.text.trim() : "";
    if (text.length < 2) throw new Error("Nothing to read.");
    const voice = typeof row?.voice === "string" ? row.voice : "";
    return { text: text.slice(0, 700), voice, ...readProvider(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; audioBase64: string } | { ok: false; error: string }> => {
    const language = detectLanguage(data.text);
    if (data.provider !== "worker") {
      return { ok: false, error: "Gemini has no male voice in this studio." };
    }
    const result = await workerPost("/api/v1/speak", data.workerUrl, data.workerToken, {
      text: data.text,
      language,
      voice: voiceFor(language, data.voice),
    });
    if (!result.ok) return result;
    const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
    const audio = typeof row.audioBase64 === "string" ? row.audioBase64 : "";
    if (audio.length < 100) return { ok: false, error: "The worker voice track came back empty." };
    return { ok: true, audioBase64: audio };
  });

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? clip(value, max) : "";
}

function parseDirection(raw: string): Direction | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const characters = Array.isArray(row.characters) ? row.characters : [];
  const scenes = Array.isArray(row.scenes) ? row.scenes : [];
  const cast: Character[] = [];
  for (const item of characters.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const character = item as Record<string, unknown>;
    const name = asText(character.name, 40);
    if (!name) continue;
    cast.push({
      id: asText(character.id, 32) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      soul: asText(character.soul, 280) || "Identity stays with this name.",
      vessel: asText(character.vessel, 280) || "Body not stated.",
      look: asText(character.look, 280) || asText(character.vessel, 280),
    });
  }
  const panels: Scene[] = [];
  for (const [index, item] of scenes.entries()) {
    if (!item || typeof item !== "object") continue;
    const scene = item as Record<string, unknown>;
    const caption = asText(scene.caption, 240);
    const dialogue = asText(scene.dialogue, 180);
    if (!caption && !dialogue) continue;
    panels.push({
      id: `s${index + 1}`,
      caption,
      dialogue,
      speaker: asText(scene.speaker, 40),
      sfx: asText(scene.sfx, 16).toUpperCase(),
      state: asText(scene.state, 160),
      imagePrompt:
        asText(scene.imagePrompt, 500) || `Vertical illustrated panel, no text, no letters. ${caption} ${dialogue}`,
      imageUrl: null,
    });
  }
  if (!panels.length) return null;
  const seoRaw = row.seo && typeof row.seo === "object" ? (row.seo as Record<string, unknown>) : {};
  const tags = Array.isArray(seoRaw.tags) ? seoRaw.tags.filter((tag) => typeof tag === "string").slice(0, 8) : [];
  return {
    title: asText(row.title, 80) || "Untitled chapter",
    logline: asText(row.logline, 200),
    timeline: Array.isArray(row.timeline) ? row.timeline.filter((note) => typeof note === "string") : [],
    characters: cast,
    scenes: panels,
    narration: asText(row.narration, 20000),
    seo: {
      title: asText(seoRaw.title, 100) || asText(row.title, 80),
      description: asText(seoRaw.description, 220),
      tags: tags as string[],
    },
  };
}

function blockedIp(ip: string): boolean {
  const raw = ip.toLowerCase().replace(/^::ffff:/, "");
  if (raw === "::1" || raw === "0.0.0.0" || raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) {
    return true;
  }
  const parts = raw.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return raw === "localhost";
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function assertPublic(hostname: string): Promise<string | null> {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    blockedIp(host)
  ) {
    return "That address is private. It stays blocked.";
  }
  const dns = await import("node:dns/promises");
  let records: { address: string }[] = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return "That host did not resolve.";
  }
  if (!records.length || records.some((record) => blockedIp(record.address))) {
    return "That address is private. It stays blocked.";
  }
  return null;
}

export const fetchSource = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const url = typeof (input as { url?: unknown })?.url === "string" ? (input as { url: string }).url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("That link is not a URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http and https links.");
    return { url: parsed.toString() };
  })
  .handler(async ({ data }): Promise<{ ok: true; title: string; text: string } | { ok: false; code: string; error: string }> => {
    let current = new URL(data.url);
    for (let hop = 0; hop < 3; hop += 1) {
      const blocked = await assertPublic(current.hostname);
      if (blocked) return { ok: false, code: "SSRF_BLOCKED", error: blocked };
      let res: Response;
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
          headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "AetherStudio/1.0" },
        });
      } catch {
        return { ok: false, code: "FETCH_FAILED", error: "The page did not answer." };
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return { ok: false, code: "FETCH_FAILED", error: "The page redirected nowhere." };
        current = new URL(location, current);
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 402) {
        return {
          ok: false,
          code: "SOURCE_ACCESS_DENIED",
          error: "SOURCE_ACCESS_DENIED. This page is locked. Paste the chapter text instead. Paywalls are not bypassed.",
        };
      }
      if (!res.ok) return { ok: false, code: "FETCH_FAILED", error: `The page returned ${res.status}.` };
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/.test(type)) {
        return { ok: false, code: "FETCH_FAILED", error: "That link is not a text page." };
      }
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, code: "FETCH_FAILED", error: "The page was empty." };
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 350_000) {
        const step = await reader.read();
        if (step.done) break;
        total += step.value.byteLength;
        chunks.push(step.value);
      }
      reader.cancel().catch(() => undefined);
      const html = Buffer.concat(chunks).toString("utf8");
      const extracted = htmlToText(html);
      const lowered = extracted.text.toLowerCase();
      const locked =
        extracted.text.length < 500 &&
        /sign in|log in|login|subscribe|paywall|chapter locked|purchase to read|members only/.test(lowered);
      if (locked || extracted.text.length < 80) {
        return {
          ok: false,
          code: "SOURCE_ACCESS_DENIED",
          error: "SOURCE_ACCESS_DENIED. No readable chapter here, or the page wants a login. Paste the text. Paywalls are not bypassed.",
        };
      }
      const title = extracted.title || current.hostname;
      return { ok: true, title, text: extracted.text };
    }
    return { ok: false, code: "FETCH_FAILED", error: "Too many redirects." };
  });

function redact(raw: string, secret: string, max = 280): string {
  const clean = secret ? raw.split(secret).join("[redacted]") : raw;
  return clean.slice(0, max);
}

export const testWorker = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { url?: unknown; token?: unknown };
    const token = typeof row?.token === "string" ? row.token : "";
    if (token.length > 500) throw new Error("That token is too long.");
    const target = workerEndpoint(typeof row?.url === "string" ? row.url : "", "/api/v1/health");
    return { href: target.toString(), hostname: target.hostname, token };
  })
  .handler(async ({ data }): Promise<{ ok: true; status: number; body: string } | { ok: false; error: string; status?: number; body?: string }> => {
    const blocked = await assertPublic(data.hostname);
    if (blocked) return { ok: false, error: blocked };
    let res: Response;
    try {
      res = await fetch(data.href, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json", "X-Aether-Token": data.token },
      });
    } catch {
      return { ok: false, error: "The worker did not answer." };
    }
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: "The worker redirected. Health must answer directly." };
    }
    const body = redact(await res.text(), data.token);
    if (!res.ok) return { ok: false, status: res.status, body, error: `Worker health returned ${res.status}.` };
    return { ok: true, status: res.status, body };
  });

export const submitJob = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { url?: unknown; token?: unknown; packet?: unknown };
    const token = typeof row?.token === "string" ? row.token : "";
    if (token.length > 500) throw new Error("That token is too long.");
    const target = workerEndpoint(typeof row?.url === "string" ? row.url : "", "/api/v1/jobs");
    const packet = jobPacketV2Schema.parse(row?.packet);
    return { href: target.toString(), hostname: target.hostname, token, packet };
  })
  .handler(async ({ data }): Promise<{ ok: true; status: number; body: string; jobId: string | null } | { ok: false; error: string }> => {
    const blocked = await assertPublic(data.hostname);
    if (blocked) return { ok: false, error: blocked };
    let res: Response;
    try {
      res = await fetch(data.href, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Aether-Token": data.token,
        },
        body: JSON.stringify(data.packet),
      });
    } catch {
      return { ok: false, error: "The worker did not take the job." };
    }
    if (res.status >= 300 && res.status < 400) return { ok: false, error: "The worker redirected. The job was not sent." };
    const body = redact(await res.text(), data.token);
    if (!res.ok) return { ok: false, error: body || `Worker returned ${res.status}.` };
    return { ok: true, status: res.status, body, jobId: readJobId(body) };
  });

async function workerGet(
  href: string,
  hostname: string,
  token: string,
): Promise<{ ok: true; status: number; body: string; contentType: string } | { ok: false; error: string }> {
  const blocked = await assertPublic(hostname);
  if (blocked) return { ok: false, error: blocked };
  let res: Response;
  try {
    res = await fetch(href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json, video/mp4, application/octet-stream", "X-Aether-Token": token },
    });
  } catch {
    return { ok: false, error: "The worker did not answer." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, error: "The worker redirected. Nothing was followed." };
  const hidden = redact(await res.text(), token, 100_000);
  if (!res.ok) return { ok: false, error: hidden.slice(0, 280) || `Worker returned ${res.status}.` };
  return { ok: true, status: res.status, body: hidden, contentType: res.headers.get("content-type") ?? "" };
}

export const jobStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { url?: unknown; token?: unknown; jobId?: unknown };
    const token = typeof row?.token === "string" ? row.token : "";
    if (token.length > 500) throw new Error("That token is too long.");
    const jobId = assertJobId(typeof row?.jobId === "string" ? row.jobId : "");
    const target = workerEndpoint(typeof row?.url === "string" ? row.url : "", jobResourcePath(jobId));
    return { href: target.toString(), hostname: target.hostname, token, jobId };
  })
  .handler(async ({ data }): Promise<{ ok: true; job: JobSnapshot } | { ok: false; error: string }> => {
    const result = await workerGet(data.href, data.hostname, data.token);
    if (!result.ok) return result;
    try {
      return { ok: true, job: parseJobStatus(JSON.parse(result.body), data.jobId) };
    } catch {
      return { ok: false, error: "The worker status was not JSON." };
    }
  });

function mp4Target(workerUrl: string, jobId: string, mp4Url: string | null): URL {
  const fallback = workerEndpoint(workerUrl, jobResourcePath(jobId, "mp4"));
  if (!mp4Url) return fallback;
  if (mp4Url.startsWith("/")) return new URL(mp4Url, fallback.origin);
  try {
    const parsed = new URL(mp4Url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export async function fetchWorkerMp4(input: unknown): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string }> {
  const row = input as { url?: unknown; token?: unknown; jobId?: unknown };
  const token = typeof row?.token === "string" ? row.token : "";
  if (token.length > 500) return { ok: false, error: "That token is too long." };
  let jobId = "";
  try {
    jobId = assertJobId(typeof row?.jobId === "string" ? row.jobId : "");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That job id is not valid." };
  }
  const workerUrl = typeof row?.url === "string" ? row.url : "";
  let statusUrl: URL;
  try {
    statusUrl = workerEndpoint(workerUrl, jobResourcePath(jobId));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That worker URL is not valid." };
  }
  const status = await workerGet(statusUrl.toString(), statusUrl.hostname, token);
  let mp4Url: string | null = null;
  if (status.ok) {
    try {
      mp4Url = parseJobStatus(JSON.parse(status.body), jobId).mp4Url;
    } catch {
      mp4Url = null;
    }
  }
  let target: URL;
  try {
    target = mp4Target(workerUrl, jobId, mp4Url);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The MP4 link is not valid." };
  }
  const blocked = await assertPublic(target.hostname);
  if (blocked) return { ok: false, error: blocked };
  let res: Response;
  try {
    res = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: { Accept: "video/mp4, application/octet-stream", "X-Aether-Token": token },
    });
  } catch {
    return { ok: false, error: "The MP4 did not download." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, error: "The worker redirected the MP4. Nothing was saved." };
  if (!res.ok) {
    const body = redact(await res.text(), token);
    return { ok: false, error: body || `The MP4 request returned ${res.status}.` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 64) return { ok: false, error: "The worker returned an empty video." };
  if (bytes.byteLength > 32_000_000) return { ok: false, error: "That MP4 is larger than 32 MB." };
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  if (/json|text\/html|text\/plain/.test(contentType)) {
    return { ok: false, error: redact(new TextDecoder().decode(bytes.slice(0, 280)), token) || "The worker did not return a video." };
  }
  return { ok: true, bytes, contentType: contentType.split(";")[0] || "video/mp4" };
}
