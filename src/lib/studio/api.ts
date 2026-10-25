import { createServerFn } from "@tanstack/react-start";
import { studioConfig } from "@/lib/studio/config";
import {
  cloudRequest,
  directorSystem,
  imageVia,
  readSession,
  shouldFailover,
  textFromModel,
  textVia,
  type AiSession,
} from "@/lib/studio/ai-router";
import { htmlToText, extractPanels, sanitizeNovelText } from "@/lib/studio/extract";
import { containsHan, fetchWtrChapter, parseWtrChapterUrl } from "@/lib/studio/wtr";
import { assertJobId, jobResourcePath, parseJobStatus, readJobId, type JobSnapshot } from "@/lib/studio/jobs";
import { composeLook, parseStudioAction, type StudioAction } from "@/lib/studio/bible";
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
  const hasKey = Boolean(session.apiKey.trim());
  const hasWorker = Boolean(session.workerUrl.trim());
  const via = textVia(session.duty, hasKey, hasWorker);
  if (via === "none") {
    return { ok: false, error: "Add a cloud API key or connect the Colab/Kaggle worker. Nothing is saved on this phone." };
  }
  if (via === "worker") {
    const local = await callLocal(session, system, user);
    if (local.ok) return { ok: true, text: local.text, via: "local" };
    return { ok: false, error: local.error };
  }
  const cloud = await callCloud(session, system, user, true);
  if (cloud.ok) return { ok: true, text: cloud.text, via: "cloud" };
  if (session.duty !== "key" && hasWorker && shouldFailover(cloud.status, cloud.error)) {
    const local = await callLocal(session, system, user);
    if (local.ok) return { ok: true, text: local.text, via: "local" };
    return { ok: false, error: local.error || cloud.error };
  }
  return { ok: false, error: cloud.error };
}

async function workerPost(
  path: string,
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

async function workerJson(
  path: string,
  url: string,
  token: string,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  let target: URL;
  try {
    target = workerEndpoint(url, path);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That worker URL is not valid." };
  }
  const blocked = await assertPublic(target.hostname);
  if (blocked) return { ok: false, error: blocked };
  if (token) target.searchParams.set("token", token);
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: { Accept: "application/json", "X-Aether-Token": token },
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
    const row = input as { text?: unknown; lock?: unknown };
    const text = typeof row?.text === "string" ? row.text.trim() : "";
    if (text.length < 40) throw new Error("Paste at least a short chapter.");
    if (text.length > 9000) throw new Error("That chunk is too long. The studio splits a long chapter before asking.");
    const lock = typeof row.lock === "string" ? row.lock.trim().slice(0, 1800) : "";
    return { text, lock, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; direction: Direction; via: "cloud" | "local" } | { ok: false; error: string }> => {
    const system = directorSystem(data.session.language);
    const lock = data.lock ? `CHARACTER LOCK. Use these looks in every imagePrompt. Do not narrate this lock as extra scenes.\n${data.lock}\n\n` : "";
    const user = containsHan(data.text)
      ? `${lock}Source chapter (translate every Chinese character; do not copy Chinese into the JSON):\n${data.text}`
      : `${lock}${data.text}`;
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

export const writeBeatPrompt = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { caption?: unknown; dialogue?: unknown; speaker?: unknown; state?: unknown; chapter?: unknown; lock?: unknown };
    const caption = typeof row.caption === "string" ? row.caption.slice(0, 400) : "";
    const dialogue = typeof row.dialogue === "string" ? row.dialogue.slice(0, 400) : "";
    if (!caption.trim() && !dialogue.trim()) throw new Error("That beat has no line.");
    const chapter = typeof row.chapter === "number" && Number.isFinite(row.chapter) ? Math.floor(row.chapter) : 0;
    return {
      caption,
      dialogue,
      speaker: typeof row.speaker === "string" ? row.speaker.slice(0, 40) : "",
      state: typeof row.state === "string" ? row.state.slice(0, 180) : "",
      chapter: chapter > 0 && chapter < 100000 ? chapter : 0,
      lock: typeof row.lock === "string" ? row.lock.slice(0, 1800) : "",
      session: readSession(input),
    };
  })
  .handler(async ({ data }): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> => {
    const system = [
      "Write ONE English image prompt for a single vertical manhua panel. Return JSON only: {\"prompt\":\"...\"}.",
      "Colored manhwa, clean ink, dramatic close-up or action as this one line needs.",
      "Paste the character lock in full. No random extra people. No watermark. No letters, logos, or speech bubbles inside the picture.",
      "Do not translate the prompt. Do not write the spoken line as text in the drawing.",
    ].join(" ");
    const user = [
      data.lock ? `CHARACTER LOCK:\n${data.lock}` : "",
      `This beat only. Chapter ${data.chapter || "unknown"}. Speaker: ${data.speaker || "narrator"}.`,
      `Caption: ${data.caption}`,
      `Dialogue: ${data.dialogue}`,
      `State: ${data.state}`,
    ]
      .filter(Boolean)
      .join("\n");
    const result = await callActiveAI(data.session, system, user);
    if (!result.ok) return result;
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    let prompt = "";
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(result.text.slice(start, end + 1)) as { prompt?: unknown };
        if (typeof parsed.prompt === "string") prompt = parsed.prompt.trim();
      } catch {
        prompt = "";
      }
    }
    if (!prompt) prompt = result.text.replace(/\s+/g, " ").trim();
    prompt = prompt.replace(/^prompt\s*:\s*/i, "").slice(0, 700);
    if (prompt.length < 8) return { ok: false, error: "The writer did not return a prompt. The picture was not drawn." };
    return { ok: true, prompt };
  });

function referenceParts(value: unknown): { reference: string; referenceBase64: string } {
  if (typeof value !== "string") return { reference: "", referenceBase64: "" };
  const raw = value.trim();
  if (/^https:\/\//i.test(raw)) return { reference: raw.slice(0, 2000), referenceBase64: "" };
  const match = raw.match(/^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i);
  if (!match?.[1]) return { reference: "", referenceBase64: "" };
  const data = match[1].replace(/\s/g, "");
  if (data.length < 80 || data.length > 900_000) return { reference: "", referenceBase64: "" };
  return { reference: "", referenceBase64: data };
}

export const paintPanel = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { prompt?: unknown; reference?: unknown; repo?: unknown };
    const prompt = typeof row?.prompt === "string" ? row.prompt.trim() : "";
    if (prompt.length < 8) throw new Error("That panel has no picture note.");
    const repo = typeof row.repo === "string" ? row.repo.trim().slice(0, 200) : "";
    return { prompt: prompt.slice(0, 900), repo, ...referenceParts(row.reference), session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; url: string; fallback?: boolean; engine?: string } | { ok: false; error: string }> => {
    const painted = `Vertical colored manhwa, clean ink, dramatic lighting, consistent character, no text, no letters, no watermark, no speech bubbles. ${data.prompt}`;
    const paintWorker = async () => {
      const result = await workerPost("/api/v1/paint", data.session.workerUrl, data.session.workerToken, {
        prompt: painted,
        negative: "text, letters, logos, watermark, speech bubbles",
        reference: data.reference,
        referenceBase64: data.referenceBase64,
        repo: data.repo,
      });
      if (!result.ok) return result;
      const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
      const fallback = row.fallback === true || row.engine === "pollinations" || row.engine === "ink";
      const engine = typeof row.engine === "string" ? row.engine.slice(0, 40) : "";
      if (typeof row.url === "string" && row.url) return { ok: true as const, url: row.url, ...(fallback ? { fallback: true } : {}), ...(engine ? { engine } : {}) };
      if (typeof row.imageBase64 === "string" && row.imageBase64) {
        const mime = typeof row.mimeType === "string" ? row.mimeType : "image/png";
        return { ok: true as const, url: `data:${mime};base64,${row.imageBase64}`, ...(fallback ? { fallback: true } : {}), ...(engine ? { engine } : {}) };
      }
      return { ok: false as const, error: "The worker returned no image." };
    };
    const route = imageVia(data.session.duty, Boolean(data.session.workerUrl.trim()));
    if (route === "worker") {
      const drawn = await paintWorker();
      if (drawn.ok) return drawn;
    }
    const prompt = encodeURIComponent(painted.slice(0, 480));
    return {
      ok: true,
      fallback: true,
      engine: "pollinations",
      url: `https://image.pollinations.ai/prompt/${prompt}?width=768&height=1152&nologo=true&model=flux`,
    };
  });

export const speakLine = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { text?: unknown; voice?: unknown; sceneId?: unknown; force?: unknown };
    const text = typeof row?.text === "string" ? row.text.trim() : "";
    if (text.length < 2) throw new Error("Nothing to read.");
    const voice = typeof row?.voice === "string" ? row.voice : "";
    const sceneId = typeof row.sceneId === "string" ? row.sceneId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) : "";
    return { text: text.slice(0, 12000), voice, sceneId, force: row.force === true, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; audioBase64: string; mimeType: string; audioUrl?: string } | { ok: false; error: string }> => {
    const language = data.session.language;
    const voice = data.voice.trim() || (language === "hi" ? "hi-IN-MadhurNeural" : "en-US-ChristopherNeural");
    if (data.session.workerUrl.trim() && data.session.duty !== "key") {
      const result = await workerPost("/api/v1/speak", data.session.workerUrl, data.session.workerToken, {
        text: data.text.slice(0, 700),
        language,
        voice,
        sceneId: data.sceneId || "line",
        force: data.force,
      });
      if (result.ok) {
        const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
        const audio = typeof row.audioBase64 === "string" ? row.audioBase64 : "";
        const audioUrl = typeof row.url === "string" && row.url.startsWith("/api/v1/voices/") ? row.url.slice(0, 180) : "";
        const mimeType = typeof row.mimeType === "string" && row.mimeType ? row.mimeType : "audio/mpeg";
        if (audio.length >= 100 || audioUrl) return { ok: true, audioBase64: audio, mimeType, ...(audioUrl ? { audioUrl } : {}) };
      }
    }
    if (data.session.provider === "gemini" && data.session.apiKey && data.session.duty === "key") return geminiSpeak(data.session.apiKey, data.text);
    const edge = await edgeSpeak(data.text, voice);
    if (edge.ok) return edge;
    return { ok: false, error: "Microsoft voice did not answer, and the worker has no saved track yet. Connect the worker so a local male voice can speak." };
  });

function escapeSsml(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

async function edgeSpeak(
  text: string,
  voice: string,
): Promise<{ ok: true; audioBase64: string; mimeType: string } | { ok: false; error: string }> {
  const name = voice.trim() || "en-US-ChristopherNeural";
  const lang = name.startsWith("hi-") ? "hi-IN" : "en-US";
  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://edge.microsoft.com/translate/auth", {
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
  } catch {
    return { ok: false, error: "Free voice did not answer." };
  }
  if (!tokenRes.ok) return { ok: false, error: "Free voice refused the token." };
  const token = (await tokenRes.text()).trim();
  if (!token) return { ok: false, error: "Free voice returned an empty token." };
  const pieces = speechChunks(text);
  const chunks: Buffer[] = [];
  for (const piece of pieces) {
    const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${escapeSsml(name)}">${escapeSsml(piece)}</voice></speak>`;
    let res: Response;
    try {
      res = await fetch("https://speech.platform.bing.com/cognitiveservices/v1", {
        method: "POST",
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "Mozilla/5.0",
        },
        body: ssml,
      });
    } catch {
      return { ok: false, error: "Free voice timed out." };
    }
    if (!res.ok) return { ok: false, error: `Free voice returned ${res.status}.` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 128) return { ok: false, error: "Free voice returned empty audio." };
    chunks.push(bytes);
  }
  if (!chunks.length) return { ok: false, error: "Nothing to read." };
  return { ok: true, audioBase64: Buffer.concat(chunks).toString("base64"), mimeType: "audio/mpeg" };
}

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
    const look = asText(character.look, 280) || asText(character.vessel, 280);
    const rowCast: Character = {
      id: asText(character.id, 32) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      soul: asText(character.soul, 280) || "Identity stays with this name.",
      vessel: asText(character.vessel, 280) || "Body not stated.",
      look,
      face: asText(character.face, 180),
      hair: asText(character.hair, 180),
      age: asText(character.age, 40),
      scars: asText(character.scars, 180),
      eyes: asText(character.eyes, 80),
      body: asText(character.body, 180),
      outfit: asText(character.outfit, 180),
    };
    rowCast.look = composeLook(rowCast) || look;
    rowCast.vessel = rowCast.outfit || rowCast.vessel;
    cast.push(rowCast);
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
      imagePrompt: "",
      imageUrl: null,
      promptLocked: false,
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

async function readHtml(
  url: URL,
  cookie = "",
): Promise<{ ok: true; html: string; finalUrl: URL } | { ok: false; code: string; error: string }> {
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
          headers: { ...PAGE_HEADERS, "User-Agent": agent, ...(cookie ? { Cookie: cookie } : {}) },
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

function safeCookie(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\r\n]/g, "").trim();
  if (!clean) return "";
  if (clean.length > 4000) throw new Error("That cookie is too long.");
  if (!/^[\x20-\x7E]+$/.test(clean)) throw new Error("The cookie has characters this fetch will not send.");
  return clean;
}

export const fetchSource = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { url?: unknown; cookie?: unknown };
    const url = typeof row?.url === "string" ? row.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("That link is not a URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http and https links.");
    return { url: parsed.toString(), cookie: safeCookie(row.cookie) };
  })
  .handler(async ({ data }): Promise<
    | { ok: true; title: string; text: string; panels: { src: string; text: string; bubble: string; aside: string }[] }
    | { ok: false; code: string; error: string }
  > => {
    const page = new URL(data.url);
    const blocked = await assertPublic(page.hostname);
    if (blocked) return { ok: false, code: "SSRF_BLOCKED", error: blocked };

    const wtr = parseWtrChapterUrl(data.url);
    if (wtr && !data.cookie) {
      try {
        const chapter = await fetchWtrChapter(wtr);
        if (chapter && chapter.text.length >= 80) {
          const text = sanitizeNovelText(chapter.text);
          const title = sanitizeNovelText(chapter.title);
          if (text.length >= 80) return { ok: true, title: title || page.hostname, text, panels: [] };
        }
      } catch {
        /* fall through to a normal page read */
      }
    }

    const direct = await readHtml(page, data.cookie);
    if (direct.ok) {
      const challenge = looksLikeChallenge(direct.html);
      const extracted = htmlToText(direct.html);
      const panels = extractPanels(direct.html, direct.finalUrl.toString());
      if (!challenge && (extracted.text.length >= 80 || panels.length > 0) && !looksLikePaywall(extracted.text)) {
        return {
          ok: true,
          title: extracted.title || direct.finalUrl.hostname,
          text: extracted.text,
          panels,
        };
      }
    } else if (direct.code === "SSRF_BLOCKED") {
      return direct;
    }

    const fallback = data.cookie ? null : await readViaReader(data.url);
    if (fallback) {
      return { ok: true, title: fallback.title || page.hostname, text: fallback.text, panels: [] };
    }

    if (direct.ok && looksLikeChallenge(direct.html)) {
      return {
        ok: false,
        code: "FETCH_BLOCKED",
        error: "The site blocked the fetch (Cloudflare or a script-only page). Paste the chapter, or paste your browser cookie for this site. This is not a paywall.",
      };
    }
    if (!direct.ok && direct.code === "FETCH_BLOCKED") {
      return {
        ok: false,
        code: "FETCH_BLOCKED",
        error: data.cookie
          ? "The site still blocked the fetch with that cookie. Paste the chapter text."
          : "The site blocked the fetch. Paste a cookie from a tab where you are logged in, or paste the chapter text.",
      };
    }
    if (!direct.ok && direct.code === "SOURCE_ACCESS_DENIED") {
      return {
        ok: false,
        code: "SOURCE_ACCESS_DENIED",
        error: data.cookie
          ? "That cookie was rejected. Paste the chapter text. Passwords are not accepted."
          : "This page wants a login. Paste your browser cookie for this site, or paste the chapter text. Passwords are not accepted.",
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
    const language = row.language === "hi" ? "hi" : "en";
    return { href: target.toString(), hostname: target.hostname, token, accessToken, jobId, title, description, tags, privacy, language };
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
          language: data.language,
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

export const translateLines = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { target?: unknown; lines?: unknown };
    const target = row.target === "hi" ? "hi" : row.target === "en" ? "en" : "";
    if (!target) throw new Error("Pick English or Hindi.");
    if (!Array.isArray(row.lines) || row.lines.length === 0) throw new Error("No lines to translate.");
    if (row.lines.length > 40) throw new Error("Translate at most 40 lines at a time.");
    const lines = row.lines.map((item) => {
      const line = item as { id?: unknown; caption?: unknown; dialogue?: unknown };
      const id = typeof line.id === "string" ? line.id.slice(0, 40) : "";
      if (!id) throw new Error("A line is missing its id.");
      return {
        id,
        caption: typeof line.caption === "string" ? line.caption.slice(0, 400) : "",
        dialogue: typeof line.dialogue === "string" ? line.dialogue.slice(0, 400) : "",
      };
    });
    return { target, lines, session: readSession({ ...(input as object), language: target }) };
  })
  .handler(async ({ data }): Promise<
    | { ok: true; lines: { id: string; caption: string; dialogue: string }[]; narration: string; seo: { title: string; description: string; tags: string[]; hashtags: string } }
    | { ok: false; error: string }
  > => {
    const system = [
      `Translate every string into ${data.target === "hi" ? "Hindi in Devanagari" : "English"}.`,
      "Return JSON only: {lines:[{id,caption,dialogue}], narration, seo:{title,description,tags,hashtags}}.",
      "Keep each id exactly. Do not add panels. Do not write image prompts. Do not mention pictures.",
    ].join(" ");
    const result = await callActiveAI(data.session, system, JSON.stringify({ lines: data.lines }));
    if (!result.ok) return { ok: false, error: `${result.error} Pictures were not touched.` };
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, error: "The translator did not return a script. Pictures were not touched." };
    let parsed: {
      lines?: { id?: unknown; caption?: unknown; dialogue?: unknown }[];
      narration?: unknown;
      seo?: { title?: unknown; description?: unknown; tags?: unknown; hashtags?: unknown };
    };
    try {
      parsed = JSON.parse(result.text.slice(start, end + 1)) as typeof parsed;
    } catch {
      return { ok: false, error: "The translator returned a script this studio could not read. Pictures were not touched." };
    }
    const wanted = new Set(data.lines.map((line) => line.id));
    const lines = (parsed.lines ?? [])
      .map((line) => ({
        id: typeof line.id === "string" ? line.id : "",
        caption: typeof line.caption === "string" ? line.caption.slice(0, 400) : "",
        dialogue: typeof line.dialogue === "string" ? line.dialogue.slice(0, 400) : "",
      }))
      .filter((line) => wanted.has(line.id));
    if (!lines.length) return { ok: false, error: "The translator dropped the lines. Pictures were not touched." };
    const seo = parsed.seo ?? {};
    const tags = Array.isArray(seo.tags) ? seo.tags.filter((tag) => typeof tag === "string").slice(0, 12) : [];
    return {
      ok: true,
      lines,
      narration: typeof parsed.narration === "string" ? parsed.narration.slice(0, 20000) : "",
      seo: {
        title: typeof seo.title === "string" ? seo.title.slice(0, 100) : "",
        description: typeof seo.description === "string" ? seo.description.slice(0, 500) : "",
        tags: tags as string[],
        hashtags: typeof seo.hashtags === "string" ? seo.hashtags.slice(0, 200) : "",
      },
    };
  });

export const chatTurn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { message?: unknown; context?: unknown };
    const message = typeof row.message === "string" ? row.message.trim() : "";
    if (message.length < 1) throw new Error("Type a message.");
    if (message.length > 2000) throw new Error("That message is too long.");
    const context = typeof row.context === "string" ? row.context.slice(0, 4000) : "";
    return { message, context, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; reply: string; action: StudioAction | null } | { ok: false; error: string }> => {
    const system = [
      "You are the assistant inside a manhua explanation studio.",
      "Answer in the same language the user wrote.",
      "If they ask to change English/Hindi voiceover, tell them Re-voice only changes the spoken script, audio, captions, and YouTube text. It does not redraw pictures.",
      "Do not claim you generated an image unless the user already said a panel was painted.",
      "When the user corrects one character's look, end with a single line: ACTION {\"type\":\"look\",\"name\":\"Exact Name\",\"face\":\"\",\"hair\":\"\",\"age\":\"\",\"scars\":\"\",\"eyes\":\"\",\"body\":\"\",\"outfit\":\"\",\"chapter\":0}",
      "Include only the fields they changed. chapter is 0 unless they named a chapter for an outfit change.",
      "When the user corrects one spoken line, end with: ACTION {\"type\":\"line\",\"id\":\"s1\",\"text\":\"the new spoken line only\"}",
      "Use the beat id from the project context. If they are only asking a question, do not add an ACTION line.",
    ].join(" ");
    const result = await callActiveAI(data.session, system, data.context ? `Project:\n${data.context}\n\nUser:\n${data.message}` : data.message);
    if (!result.ok) return result;
    const parsed = parseStudioAction(result.text.trim().slice(0, 4000));
    return { ok: true, reply: parsed.reply || result.text.trim().slice(0, 4000), action: parsed.action };
  });

async function imageBytes(url: string): Promise<{ mime: string; data: string } | null> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match?.[1] || !match[2]) return null;
    if (match[2].length > 5_000_000) return null;
    return { mime: match[1], data: match[2].replace(/\s/g, "") };
  }
  if (!/^https:\/\//i.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const blocked = await assertPublic(parsed.hostname);
  if (blocked) return null;
  let res: Response;
  try {
    res = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64 || buf.length > 4_000_000) return null;
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg";
  if (!mime.startsWith("image/")) return null;
  return { mime, data: buf.toString("base64") };
}

export const checkPanel = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { prompt?: unknown; imageUrl?: unknown };
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    const imageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
    if (prompt.length < 8 || !imageUrl) throw new Error("Nothing to check.");
    return { prompt: prompt.slice(0, 700), imageUrl: imageUrl.slice(0, 1_200_000), session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; match: "yes" | "no" | "skipped"; note: string } | { ok: false; error: string }> => {
    const image = await imageBytes(data.imageUrl);
    const workerChecker = Boolean(data.session.workerUrl.trim()) && data.session.duty !== "key";
    const geminiChecker = data.session.provider === "gemini" && Boolean(data.session.apiKey) && data.session.duty !== "worker";
    if (workerChecker) {
      const result = await workerPost("/api/v1/check", data.session.workerUrl, data.session.workerToken, {
        prompt: data.prompt,
        imageUrl: data.imageUrl.startsWith("data:") ? "" : data.imageUrl.slice(0, 2000),
        imageBase64: image?.data || "",
      });
      if (result.ok && result.json && typeof result.json === "object") {
        const row = result.json as Record<string, unknown>;
        const match = row.match === false || row.match === "no" ? "no" : row.match === true || row.match === "yes" ? "yes" : "skipped";
        const note = typeof row.note === "string" ? row.note.slice(0, 240) : "";
        if (match !== "skipped") return { ok: true, match, note };
      }
    }
    if (geminiChecker) {
      if (!image) return { ok: true, match: "skipped", note: "Checker could not read the file. Picture kept." };
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${studioConfig.geminiModel}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": data.session.apiKey },
            signal: AbortSignal.timeout(40000),
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `Compare the image to this manhua prompt. Reply JSON only: {"match":true|false,"note":"one sentence"}. Fail the match if the face, hair, outfit, or scene is clearly wrong. Prompt: ${data.prompt}`,
                    },
                    { inlineData: { mimeType: image.mime, data: image.data } },
                  ],
                },
              ],
            }),
          },
        );
      } catch {
        return { ok: true, match: "skipped", note: "Checker did not answer. Picture kept." };
      }
      if (!res.ok) return { ok: true, match: "skipped", note: "Checker could not look. Picture kept." };
      try {
        const body = JSON.parse(await res.text()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) return { ok: true, match: "skipped", note: "Checker reply was unclear. Picture kept." };
        const verdict = JSON.parse(text.slice(start, end + 1)) as { match?: unknown; note?: unknown };
        const note = typeof verdict.note === "string" ? verdict.note.slice(0, 240) : "";
        return { ok: true, match: verdict.match === false ? "no" : "yes", note };
      } catch {
        return { ok: true, match: "skipped", note: "Checker reply was unclear. Picture kept." };
      }
    }
    return { ok: true, match: "skipped", note: "No checker connected. Picture kept. Connect the worker, or a Gemini key, to verify the face." };
  });

type PulledPage = {
  url: string;
  ok: boolean;
  title: string;
  text: string;
  error: string;
  panels: { src: string; text: string; bubble: string; aside: string }[];
};

function asPages(value: unknown): PulledPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 220).map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const panels = Array.isArray(row.panels)
      ? row.panels.slice(0, 80).map((panel) => {
          const box = panel && typeof panel === "object" ? (panel as Record<string, unknown>) : {};
          const src = typeof box.src === "string" ? box.src.slice(0, 500) : "";
          const bubble = typeof box.bubble === "string" ? box.bubble.slice(0, 400) : "";
          const aside = typeof box.aside === "string" ? box.aside.slice(0, 400) : "";
          const text = typeof box.text === "string" ? box.text.slice(0, 500) : [bubble, aside].filter(Boolean).join(" ");
          return { src, text, bubble, aside };
        })
      : [];
    return {
      url: typeof row.url === "string" ? row.url.slice(0, 500) : "",
      ok: row.ok !== false,
      title: typeof row.title === "string" ? row.title.slice(0, 180) : "",
      text: typeof row.text === "string" ? row.text.slice(0, 20000) : "",
      error: typeof row.error === "string" ? row.error.slice(0, 200) : "",
      panels: panels.filter((panel) => panel.src.startsWith("http")),
    };
  });
}

export const startWorkerFetch = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { urls?: unknown; cookie?: unknown };
    if (!Array.isArray(row.urls) || row.urls.length === 0) throw new Error("No chapter links to send.");
    if (row.urls.length > 180) throw new Error("That range is too long for one worker fetch. Split it.");
    const urls = row.urls.map((item) => {
      if (typeof item !== "string") throw new Error("A chapter link is not a URL.");
      let parsed: URL;
      try {
        parsed = new URL(item.trim());
      } catch {
        throw new Error("A chapter link is not a URL.");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http and https links.");
      return parsed.toString();
    });
    return { urls, cookie: safeCookie(row.cookie), session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> => {
    if (!data.session.workerUrl.trim()) return { ok: false, error: "Add the worker URL first. Long ranges are fetched there, not on this phone." };
    for (const url of data.urls) {
      const blocked = await assertPublic(new URL(url).hostname);
      if (blocked) return { ok: false, error: blocked };
    }
    const result = await workerPost("/api/v1/fetch", data.session.workerUrl, data.session.workerToken, {
      urls: data.urls,
      cookie: data.cookie,
    });
    if (!result.ok) return result;
    const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
    const jobId = typeof row.id === "string" ? row.id : "";
    if (!/^[A-Za-z0-9]{6,32}$/.test(jobId)) return { ok: false, error: "The worker did not start the fetch." };
    return { ok: true, jobId };
  });

export const workerFetchStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { jobId?: unknown };
    const jobId = typeof row.jobId === "string" ? row.jobId.trim() : "";
    if (!/^[A-Za-z0-9]{6,32}$/.test(jobId)) throw new Error("That fetch id is not valid.");
    return { jobId, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; status: string; label: string; progress: number; pages: PulledPage[] } | { ok: false; error: string }> => {
    const result = await workerJson(`/api/v1/fetch/${data.jobId}`, data.session.workerUrl, data.session.workerToken);
    if (!result.ok) return result;
    const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
    const progress = typeof row.progress === "number" ? Math.max(0, Math.min(100, Math.round(row.progress))) : 0;
    return {
      ok: true,
      status: typeof row.status === "string" ? row.status : "running",
      label: typeof row.label === "string" ? row.label.slice(0, 80) : "",
      progress,
      pages: asPages(row.pages),
    };
  });

export const readPanelText = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { images?: unknown };
    if (!Array.isArray(row.images) || row.images.length === 0) throw new Error("No panels to read.");
    if (row.images.length > 8) throw new Error("Read at most 8 panels at a time.");
    const images = row.images.map((item) => {
      const box = item as { id?: unknown; url?: unknown };
      const id = typeof box.id === "string" ? box.id.slice(0, 40) : "";
      const url = typeof box.url === "string" ? box.url.trim() : "";
      if (!id || !/^https?:\/\//i.test(url)) throw new Error("A panel image is missing its link.");
      return { id, url: url.slice(0, 500) };
    });
    return { images, session: readSession(input) };
  })
  .handler(async ({ data }): Promise<{ ok: true; panels: { id: string; bubble: string; aside: string }[] } | { ok: false; error: string }> => {
    if (!data.session.workerUrl.trim()) return { ok: false, error: "Bubble reading needs the worker." };
    const result = await workerPost("/api/v1/ocr", data.session.workerUrl, data.session.workerToken, { images: data.images });
    if (!result.ok) return result;
    const row = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>) : {};
    const panels = Array.isArray(row.panels)
      ? row.panels.map((item) => {
          const box = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            id: typeof box.id === "string" ? box.id.slice(0, 40) : "",
            bubble: typeof box.bubble === "string" ? box.bubble.slice(0, 400) : "",
            aside: typeof box.aside === "string" ? box.aside.slice(0, 400) : "",
          };
        })
      : [];
    return { ok: true, panels };
  });


export function sanitizeChapterContent(text: string): string {
  if (!text) return "";
  return text.replace(/cl\.adform\.net[^\s]*/gi, "").replace(/This is a cached snapshot.*?probe/gis, "").replace(/Ad Blocker Detected.*?content\./gis, "").replace(/(?:footer|copyright|about us|discord|patreon).*$/gim, "").replace(/\n\s*\n/g, "\n").trim();
}
