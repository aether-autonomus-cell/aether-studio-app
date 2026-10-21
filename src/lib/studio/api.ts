import { createServerFn } from "@tanstack/react-start";
import { studioConfig } from "@/lib/studio/config";
import {
  cloudRequest,
  directorSystem,
  readSession,
  shouldFailover,
  textFromModel,
  type AiSession,
} from "@/lib/studio/ai-router";
import { htmlToText, sanitizeNovelText } from "@/lib/studio/extract";
import { containsHan, fetchWtrChapter, parseWtrChapterUrl } from "@/lib/studio/wtr";
import { assertJobId, jobResourcePath, parseJobStatus, readJobId, type JobSnapshot } from "@/lib/studio/jobs";
import type { Character, Scene, Seo } from "@/lib/studio/model";
import { jobPacketV2Schema } from "@/lib/studio/schema";
import { workerEndpoint, type WorkerPath } from "@/lib/studio/worker";

type Direction = {
  title: string;
  hook: string;
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

async function geminiText(
  apiKey: string,
  system: string,
  user: string,
  model: string = studioConfig.geminiModel,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
    return { ok: false, error: "Gemini did not answer.", status: 0 };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `Gemini could not finish that call (${res.status}).`, status: res.status };
  let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false, error: "Gemini returned a plan this studio could not read.", status: res.status };
  }
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
  if (!text.trim()) return { ok: false, error: "Gemini returned an empty plan.", status: res.status };
  return { ok: true, text };
}

async function openaiText(
  call: { url: string; model: string; headers: Record<string, string> },
  system: string,
  user: string,
  jsonMode: boolean,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: call.model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch {
    return { ok: false, error: "The cloud model did not answer.", status: 0 };
  }
  const raw = await res.text();
  const hidden = raw.split(call.headers.Authorization ?? "").join("[redacted]");
  if (!res.ok) {
    return { ok: false, error: hidden.slice(0, 280) || `Cloud model returned ${res.status}.`, status: res.status };
  }
  try {
    const text = textFromModel(JSON.parse(raw));
    if (!text.trim()) return { ok: false, error: "The cloud model returned an empty plan.", status: res.status };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "The cloud model returned a plan this studio could not read.", status: res.status };
  }
}

async function callCloud(
  session: AiSession,
  system: string,
  user: string,
  jsonMode: boolean,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  const call = cloudRequest(session);
  if (!call) return { ok: false, error: "No cloud API key in this tab.", status: 0 };
  if (call.kind === "gemini") return geminiText(call.apiKey, system, user, call.model);
  const first = await openaiText(call, system, user, jsonMode);
  if (first.ok || !jsonMode || first.status === 0) return first;
  return openaiText(call, system, user, false);
}

async function callLocal(
  session: AiSession,
  system: string,
  user: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!session.workerUrl.trim()) return { ok: false, error: "No Colab or Kaggle worker is connected." };
  const result = await workerPost("/api/v1/llm", session.workerUrl, session.workerToken, {
    system,
    prompt: user,
    model_mode: session.localModel,
    language: session.language,
  });
  if (!result.ok) return result;
  const text = textFromModel(result.json);
  if (!text.trim()) return { ok: false, error: "Local AI returned an empty script." };
  return { ok: true, text };
}

export async function callActiveAI(
  session: AiSession,
  system: string,
  user: string,
): Promise<{ ok: true; text: string; via: "cloud" | "local" } | { ok: false; error: string }> {
  const cloud = await callCloud(session, system, user, true);
  if (cloud.ok) return { ok: true, text: cloud.text, via: "cloud" };
  const workerReady = Boolean(session.workerUrl.trim());
  if (!session.apiKey.trim() && !workerReady) {
    return { ok: false, error: "Add a cloud API key or connect the Colab/Kaggle worker. Nothing is saved on this phone." };
  }
  if (!workerReady || !shouldFailover(cloud.status, cloud.error)) return { ok: false, error: cloud.error };
  const local = await callLocal(session, system, user);
  if (local.ok) return { ok: true, text: local.text, via: "local" };
  return { ok: false, error: local.error || cloud.error };
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

export const directChapter = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const text = typeof (input as { text?: unknown })?.text === "string" ? (input as { text: string }).text.trim() : "";
    if (text.length < 40) throw new Error("Paste at least a short chapter.");
    if (text.length > 9000) throw new Error("That chunk is too long. The studio splits a long chapter before asking.");
    return { text, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; direction: Direction; via: "cloud" | "local" } | { ok: false; error: string }> => {
    const system = directorSystem(data.session.language);
    const user = containsHan(data.text)
      ? `Source chapter (translate every Chinese character; do not copy Chinese into the JSON):\n${data.text}`
      : data.text;
    let result = await callActiveAI(data.session, system, user);
    if (!result.ok) return result;
    let via: "cloud" | "local" = result.via;
    let direction = parseDirection(result.text);
    if (direction && containsHan(`${direction.narration}\n${direction.hook}\n${direction.scenes.map((scene) => `${scene.caption} ${scene.dialogue}`).join("\n")}`)) {
      const retry = await callActiveAI(
        data.session,
        system,
        `The previous JSON still contained Chinese. Translate it fully into ${data.session.language === "hi" ? "Hindi" : "English"} and return JSON only.\n${result.text.slice(0, 6000)}`,
      );
      if (retry.ok) {
        const again = parseDirection(retry.text);
        if (again) {
          direction = again;
          via = retry.via;
        }
      }
    }
    if (!direction) return { ok: false, error: "The director returned a plan this studio could not read." };
    const spoken = `${direction.narration}\n${direction.hook}\n${direction.scenes.map((scene) => `${scene.caption} ${scene.dialogue}`).join("\n")}`;
    if (containsHan(spoken)) return { ok: false, error: "The script still had Chinese in it. Run the director again." };
    if (!direction.narration) {
      direction.narration = [direction.hook, ...direction.scenes.map((scene) => [scene.caption, scene.dialogue].filter(Boolean).join(" "))]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return { ok: true, direction, via };
  });

export const paintPanel = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const prompt = typeof (input as { prompt?: unknown })?.prompt === "string" ? (input as { prompt: string }).prompt.trim() : "";
    if (prompt.length < 8) throw new Error("That panel has no picture note.");
    return { prompt: prompt.slice(0, 700), session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    const painted = `Vertical manhua comic panel, fictional illustration, no text, no letters, no watermark, no speech bubbles, no logos. ${data.prompt}`;
    const paintWorker = async () => {
      const result = await workerPost("/api/v1/paint", data.session.workerUrl, data.session.workerToken, {
        prompt: painted,
        negative: "text, letters, logos, watermark, speech bubbles",
      });
      if (!result.ok) return result;
      const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
      if (typeof row.url === "string" && row.url) return { ok: true as const, url: row.url };
      if (typeof row.imageBase64 === "string" && row.imageBase64) {
        const mime = typeof row.mimeType === "string" ? row.mimeType : "image/png";
        return { ok: true as const, url: `data:${mime};base64,${row.imageBase64}` };
      }
      return { ok: false as const, error: "The worker returned no image." };
    };
    if (data.session.provider === "gemini" && data.session.apiKey) {
      let res: Response | null = null;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${studioConfig.geminiImageModel}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": data.session.apiKey },
            signal: AbortSignal.timeout(60000),
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: painted }] }],
              generationConfig: { responseModalities: ["IMAGE"] },
            }),
          },
        );
      } catch {
        res = null;
      }
      if (res?.ok) {
        let body: { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
        try {
          body = JSON.parse(await res.text()) as typeof body;
        } catch {
          body = {};
        }
        const image = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
        if (image?.data) return { ok: true, url: `data:${image.mimeType || "image/png"};base64,${image.data}` };
      }
    }
    if (data.session.workerUrl.trim()) return paintWorker();
    return { ok: false, error: "Painting needs a Gemini key in this tab, or a connected Colab/Kaggle worker." };
  });

export const speakLine = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { text?: unknown; voice?: unknown };
    const text = typeof row?.text === "string" ? row.text.trim() : "";
    if (text.length < 2) throw new Error("Nothing to read.");
    const voice = typeof row?.voice === "string" ? row.voice : "";
    return { text: text.slice(0, 12000), voice, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; audioBase64: string; mimeType: string } | { ok: false; error: string }> => {
    const language = data.session.language;
    const voice = data.voice.trim() || (language === "hi" ? "hi-IN-MadhurNeural" : "en-US-ChristopherNeural");
    if (data.session.workerUrl.trim()) {
      const result = await workerPost("/api/v1/speak", data.session.workerUrl, data.session.workerToken, {
        text: data.text.slice(0, 700),
        language,
        voice,
      });
      if (result.ok) {
        const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
        const audio = typeof row.audioBase64 === "string" ? row.audioBase64 : "";
        if (audio.length >= 100) {
          const mimeType = typeof row.mimeType === "string" && row.mimeType ? row.mimeType : "audio/mpeg";
          return { ok: true, audioBase64: audio, mimeType };
        }
      }
    }
    if (data.session.provider === "gemini" && data.session.apiKey) return geminiSpeak(data.session.apiKey, data.text);
    return { ok: false, error: "No remote voice. Reading on this phone instead." };
  });

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function speechChunks(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest && parts.length < 20) {
    if (rest.length <= 700) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(". ", 700);
    if (cut < 180) cut = rest.lastIndexOf(" ", 700);
    if (cut < 80) cut = 700;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(piece ? cut + 1 : 700).trim();
  }
  return parts;
}

async function geminiSpeak(
  apiKey: string,
  text: string,
): Promise<{ ok: true; audioBase64: string; mimeType: string } | { ok: false; error: string }> {
  const pieces = speechChunks(text);
  if (!pieces.length) return { ok: false, error: "Nothing to read." };
  const pcmParts: Buffer[] = [];
  let sampleRate = 24000;
  for (const piece of pieces) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${studioConfig.geminiTtsModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: piece }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: studioConfig.geminiVoice } },
              },
            },
          }),
        },
      );
    } catch {
      return { ok: false, error: "Gemini voice did not answer." };
    }
    if (!res.ok) return { ok: false, error: `Gemini voice could not read that (${res.status}).` };
    let body: { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
    try {
      body = JSON.parse(await res.text()) as typeof body;
    } catch {
      return { ok: false, error: "Gemini voice returned something this studio could not read." };
    }
    const inline = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) return { ok: false, error: "Gemini voice returned no audio." };
    const mime = inline.mimeType || "audio/L16;rate=24000";
    if (!/l16|pcm|raw/i.test(mime)) {
      if (!pcmParts.length) {
        return { ok: true, audioBase64: inline.data, mimeType: mime.split(";")[0] || "audio/wav" };
      }
      break;
    }
    const rate = mime.match(/rate=(\d+)/i);
    if (rate) sampleRate = Number(rate[1]) || sampleRate;
    pcmParts.push(Buffer.from(inline.data, "base64"));
  }
  const wav = pcm16ToWav(Buffer.concat(pcmParts), sampleRate);
  return { ok: true, audioBase64: wav.toString("base64"), mimeType: "audio/wav" };
}

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
    hook: asText(row.hook, 320),
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

const PAGE_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 6000).toLowerCase();
  return /just a moment|cf-browser-verification|challenge-platform|cf-chl-|attention required|enable javascript and cookies|cdn-cgi\/challenge/.test(
    head,
  );
}

function looksLikePaywall(text: string): boolean {
  if (text.length >= 500) return false;
  return /sign in|log in|login|subscribe|paywall|chapter locked|purchase to read|members only/.test(text.toLowerCase());
}

async function readHtml(url: URL): Promise<{ ok: true; html: string; finalUrl: URL } | { ok: false; code: string; error: string }> {
  const agents = [PAGE_HEADERS["User-Agent"], DESKTOP_UA, GOOGLEBOT_UA];
  let last: { ok: false; code: string; error: string } = { ok: false, code: "FETCH_FAILED", error: "The page did not answer." };
  for (const agent of agents) {
    let current = url;
    let blockedEarly = false;
    for (let hop = 0; hop < 4; hop += 1) {
      const blocked = await assertPublic(current.hostname);
      if (blocked) return { ok: false, code: "SSRF_BLOCKED", error: blocked };
      let res: Response;
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
          headers: { ...PAGE_HEADERS, "User-Agent": agent },
        });
      } catch {
        last = { ok: false, code: "FETCH_FAILED", error: "The page did not answer." };
        blockedEarly = true;
        break;
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          last = { ok: false, code: "FETCH_FAILED", error: "The page redirected nowhere." };
          blockedEarly = true;
          break;
        }
        current = new URL(location, current);
        continue;
      }
      if (res.status === 401 || res.status === 402) {
        last = {
          ok: false,
          code: "SOURCE_ACCESS_DENIED",
          error: "This page wants a login. Paste the chapter text instead.",
        };
        blockedEarly = true;
        break;
      }
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        last = { ok: false, code: "FETCH_BLOCKED", error: "The site blocked a direct fetch." };
        break;
      }
      if (!res.ok) {
        last = { ok: false, code: "FETCH_FAILED", error: `The page returned ${res.status}.` };
        break;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        last = { ok: false, code: "FETCH_FAILED", error: "The page was empty." };
        break;
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 500_000) {
        const step = await reader.read();
        if (step.done) break;
        total += step.value.byteLength;
        chunks.push(step.value);
      }
      reader.cancel().catch(() => undefined);
      const html = Buffer.concat(chunks).toString("utf8");
      if (looksLikeChallenge(html)) {
        last = { ok: false, code: "FETCH_BLOCKED", error: "The site blocked a direct fetch." };
        if (html.length > 8000) {
          const embedded = htmlToText(html);
          if (embedded.text.length >= 80 && !looksLikePaywall(embedded.text)) {
            return { ok: true, html, finalUrl: current };
          }
        }
        break;
      }
      return { ok: true, html, finalUrl: current };
    }
    if (blockedEarly) return last;
  }
  return last;
}

async function readViaReader(pageUrl: string): Promise<{ title: string; text: string } | null> {
  let endpoint: URL;
  try {
    endpoint = new URL(`https://r.jina.ai/${pageUrl}`);
  } catch {
    return null;
  }
  const blocked = await assertPublic(endpoint.hostname);
  if (blocked) return null;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "text/plain, text/markdown, */*",
        "User-Agent": PAGE_HEADERS["User-Agent"],
        "X-Return-Format": "markdown",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const raw = (await res.text()).slice(0, 500_000);
  const titleLine = raw.match(/^Title:\s*(.+)$/m);
  const body = raw.replace(/^Title:\s*.+$/m, "").replace(/^URL Source:\s*.+$/m, "").replace(/^Markdown Content:\s*/m, "");
  const extracted = htmlToText(`<title>${titleLine?.[1] ?? ""}</title><article><p>${body}</p></article>`);
  const text = extracted.text;
  if (text.length < 80 || looksLikeChallenge(raw) || looksLikePaywall(text)) return null;
  return { title: extracted.title || titleLine?.[1]?.trim() || "", text };
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
    const page = new URL(data.url);
    const blocked = await assertPublic(page.hostname);
    if (blocked) return { ok: false, code: "SSRF_BLOCKED", error: blocked };

    const wtr = parseWtrChapterUrl(data.url);
    if (wtr) {
      try {
        const chapter = await fetchWtrChapter(wtr);
        if (chapter && chapter.text.length >= 80) {
          const text = sanitizeNovelText(chapter.text);
          const title = sanitizeNovelText(chapter.title);
          if (text.length >= 80) return { ok: true, title: title || page.hostname, text };
        }
      } catch {
        /* fall through to a normal page read */
      }
    }

    const direct = await readHtml(page);
    if (direct.ok) {
      const challenge = looksLikeChallenge(direct.html);
      const extracted = htmlToText(direct.html);
      if (!challenge && extracted.text.length >= 80 && !looksLikePaywall(extracted.text)) {
        return { ok: true, title: extracted.title || direct.finalUrl.hostname, text: extracted.text };
      }
    } else if (direct.code === "SSRF_BLOCKED") {
      return direct;
    }

    const fallback = await readViaReader(data.url);
    if (fallback) {
      return { ok: true, title: fallback.title || page.hostname, text: fallback.text };
    }

    if (direct.ok && looksLikeChallenge(direct.html)) {
      return {
        ok: false,
        code: "FETCH_BLOCKED",
        error: "The site blocked the fetch (Cloudflare or a script-only page). Paste the chapter. This is not a paywall.",
      };
    }
    if (!direct.ok && direct.code === "FETCH_BLOCKED") {
      return {
        ok: false,
        code: "FETCH_BLOCKED",
        error: "The site blocked the fetch. Paste the chapter text. A block is not treated as a paywall.",
      };
    }
    if (!direct.ok && direct.code === "SOURCE_ACCESS_DENIED") {
      return {
        ok: false,
        code: "SOURCE_ACCESS_DENIED",
        error: "This page wants a login. Paste the chapter text instead. A block is not treated as a paywall.",
      };
    }
    if (!direct.ok) return direct;
    return {
      ok: false,
      code: "FETCH_FAILED",
      error: "No chapter text on that page. Paste it instead.",
    };
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
  if (bytes.byteLength > 80_000_000) return { ok: false, error: "That MP4 is larger than 80 MB." };
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  if (/json|text\/html|text\/plain/.test(contentType)) {
    return { ok: false, error: redact(new TextDecoder().decode(bytes.slice(0, 280)), token) || "The worker did not return a video." };
  }
  return { ok: true, bytes, contentType: contentType.split(";")[0] || "video/mp4" };
}

export const verifyCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => readSession(input))
  .handler(async ({ data }): Promise<{ ok: true; badge: string } | { ok: false; error: string }> => {
    const ping = await callCloud(data, "Reply with exactly OK.", "Reply with exactly OK.", false);
    if (!ping.ok) return { ok: false, error: ping.error };
    if (!/ok/i.test(ping.text)) return { ok: false, error: "The model answered, but the check did not pass." };
    return { ok: true, badge: "API Verified & Connected — OK" };
  });

export const uploadYoutube = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as Record<string, unknown>;
    const accessToken = typeof row.accessToken === "string" ? row.accessToken.trim() : "";
    if (accessToken.length < 20 || accessToken.length > 8000) throw new Error("Connect a YouTube channel first.");
    const jobId = assertJobId(typeof row.jobId === "string" ? row.jobId : "");
    const target = workerEndpoint(typeof row.url === "string" ? row.url : "", "/api/v1/youtube-upload");
    const token = typeof row.token === "string" ? row.token : "";
    if (token.length > 500) throw new Error("That token is too long.");
    const title = typeof row.title === "string" ? row.title.slice(0, 100) : "";
    const description = typeof row.description === "string" ? row.description.slice(0, 5000) : "";
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === "string").slice(0, 15) : [];
    const privacy = row.privacy === "public" || row.privacy === "unlisted" || row.privacy === "private" ? row.privacy : "private";
    return { href: target.toString(), hostname: target.hostname, token, accessToken, jobId, title, description, tags, privacy };
  })
  .handler(async ({ data }): Promise<{ ok: true; watchUrl: string } | { ok: false; error: string }> => {
    const blocked = await assertPublic(data.hostname);
    if (blocked) return { ok: false, error: blocked };
    let res: Response;
    try {
      res = await fetch(data.href, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(120000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Aether-Token": data.token,
        },
        body: JSON.stringify({
          jobId: data.jobId,
          accessToken: data.accessToken,
          title: data.title,
          description: data.description,
          tags: data.tags,
          privacy: data.privacy,
        }),
      });
    } catch {
      return { ok: false, error: "The worker did not upload the video." };
    }
    const raw = (await res.text()).split(data.accessToken).join("[redacted]").split(data.token).join("[redacted]");
    if (!res.ok) return { ok: false, error: raw.slice(0, 280) || `YouTube upload returned ${res.status}.` };
    try {
      const json = JSON.parse(raw) as { watchUrl?: unknown };
      if (typeof json.watchUrl === "string" && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{6,}$/.test(json.watchUrl)) {
        return { ok: true, watchUrl: json.watchUrl };
      }
    } catch {
      /* fall through */
    }
    return { ok: false, error: "The worker did not return a YouTube link." };
  });

export async function fetchWorkerPreview(input: unknown): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string }> {
  const row = input as { url?: unknown; token?: unknown };
  const token = typeof row?.token === "string" ? row.token : "";
  if (token.length > 500) return { ok: false, error: "That token is too long." };
  let target: URL;
  try {
    target = workerEndpoint(typeof row?.url === "string" ? row.url : "", "/api/v1/preview.mp4");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That worker URL is not valid." };
  }
  const blocked = await assertPublic(target.hostname);
  if (blocked) return { ok: false, error: blocked };
  let res: Response;
  try {
    res = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "video/mp4, application/octet-stream", "X-Aether-Token": token },
    });
  } catch {
    return { ok: false, error: "The 6 second preview did not load." };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, error: "The worker redirected the preview." };
  if (!res.ok) return { ok: false, error: "Render the video first. The 6 second preview is not ready." };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 64 || bytes.byteLength > 12_000_000) return { ok: false, error: "That preview was empty or too large." };
  return { ok: true, bytes, contentType: "video/mp4" };
}
