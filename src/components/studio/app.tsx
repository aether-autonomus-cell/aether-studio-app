import { useEffect, useRef, useState } from "react";
import { Clapperboard, Factory, MessageCircle, Mic, ScrollText, Settings, Sparkles, Youtube } from "lucide-react";
import {
  chatTurn,
  checkPanel,
  directChapter,
  fetchSource,
  jobStatus,
  paintPanel,
  readPanelText,
  speakLine,
  startWorkerFetch,
  submitJob,
  testWorker,
  translateLines,
  uploadYoutube,
  verifyCloud,
  workerFetchStatus,
  writeBeatPrompt,
} from "@/lib/studio/api";
import {
  applyLookPatch,
  beatsNeedingPrompt,
  bibleDocument,
  composeLook,
  faceReferenceFor,
  gleanCast,
  lookLockForScene,
  mergeCast,
  outfitsToText,
  textToOutfits,
} from "@/lib/studio/bible";
import {
  gleanLooks,
  missingScript,
  rememberScript,
  srtFor,
  voiceLine,
  withLanguage,
  writeTranslated,
  type ReelLanguage,
} from "@/lib/studio/bilingual";
import {
  EXPLAIN_VOICES,
  LOCAL_MODES,
  PROVIDER_PRESETS,
  defaultModel,
  type CloudProvider,
  type Duty,
  type LocalMode,
} from "@/lib/studio/ai-router";
import { chooseVoice, loadVoices, primeSpeechUnlock, speakOnDevice } from "@/lib/studio/export";
import { sanitizeNovelText } from "@/lib/studio/extract";
import type { JobSnapshot } from "@/lib/studio/jobs";
import {
  FACTORY_CELL,
  SAMPLE,
  SAMPLE_TEXT,
  dialogueWithoutSpeaker,
  applyWorkerAssets,
  jobPacket,
  mergeCuts,
  projectFromChapters,
  projectWithAbsoluteArt,
  youtubePrivacy,
  type Character,
  type Project,
  type Scene,
} from "@/lib/studio/model";
import { chunkChapterText, expandChapterUrls } from "@/lib/studio/range";
import { containsHan } from "@/lib/studio/wtr";
import { workerEndpoint } from "@/lib/studio/worker";
import { loadProject, saveProject } from "@/lib/studio/persist";

type Tab = "story" | "forge" | "strip" | "chat" | "bay" | "youtube";
type Aspect = "16:9" | "9:16";
type SourceMode = "text" | "panels";
type ChannelSlot = { token: string; email: string; channel: string };

const EMPTY_SLOT: ChannelSlot = { token: "", email: "", channel: "" };
const voiceCache = new Map<string, string>();

const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as CloudProvider[];

function masterSrc(workerUrl: string, token: string, language: ReelLanguage): string | null {
  try {
    const target = workerEndpoint(workerUrl, `/api/v1/masters/${language}.mp4`);
    if (token.trim()) target.searchParams.set("token", token.trim());
    return target.toString();
  } catch {
    return null;
  }
}

function shownLabel(label: string, pass: "assemble" | "revoice"): string {
  if (pass === "revoice" && (!label || /generat|paint|draw|image/i.test(label))) return "Re-voicing";
  return label;
}

function safeHttp(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sourceLabel(source: Project["source"]): string {
  if (source === "sample") return "Sample painted";
  if (source === "grok") return "AI recap";
  return "Fetched chapter";
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function panelsProject(title: string, panels: { src: string; text: string; bubble?: string; aside?: string }[]): Project {
  const scenes: Scene[] = panels.map((panel, index) => {
    const bubble = panel.bubble?.trim() || "";
    const aside = panel.aside?.trim() || "";
    const line = [bubble, aside].filter(Boolean).join(" ").trim() || panel.text.trim() || `Panel ${index + 1}`;
    const caption = aside || line;
    const dialogue = bubble && aside ? bubble : "";
    return {
      id: `s${index + 1}`,
      caption,
      dialogue,
      speaker: "",
      sfx: "",
      state: "Source panel",
      imagePrompt: "Source panel. Do not redraw.",
      imageUrl: panel.src,
      locked: true,
      promptLocked: true,
      lineEn: line,
      captionEn: caption,
      dialogueEn: dialogue,
    };
  });
  return {
    ...SAMPLE,
    title: title || "Source panels",
    source: "local",
    text: scenes.map((scene) => scene.caption).join("\n\n"),
    logline: scenes[0]?.caption || title,
    characters: [],
    timeline: scenes.map((scene, index) => `Panel ${index + 1}`),
    scenes,
    narration: scenes.map((scene) => scene.caption).join(" "),
    seo: {
      ...SAMPLE.seo,
      title: `${title || "Manhua"} — explanation`,
      description: (scenes[0]?.caption || title).slice(0, 180),
    },
  };
}

function keepPrivacy(next: Project, previous: Project): Project {
  if (!previous.seo.privacy) return next;
  return { ...next, seo: { ...next.seo, privacy: previous.seo.privacy } };
}

function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(",")) {
    const tag = part.replace(/\s+/g, " ").trim().slice(0, 30);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 15) break;
  }
  return tags;
}

function wipeLegacySecrets() {
  const sweep = (storage: Storage) => {
    const doomed: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith("aether-")) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  };
  try {
    sweep(localStorage);
  } catch {
    /* private mode */
  }
  try {
    sweep(sessionStorage);
  } catch {
    /* private mode */
  }
}

type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void };

function googleAccounts():
  | {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => TokenClient;
        };
      };
    }
  | undefined {
  return (window as unknown as { google?: ReturnType<typeof googleAccounts> }).google;
}

function loadGis(): Promise<void> {
  if (googleAccounts()?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const previous = document.querySelector<HTMLScriptElement>("script[data-aether-gis]");
    if (previous) {
      previous.addEventListener("load", () => resolve(), { once: true });
      previous.addEventListener("error", () => reject(new Error("Google sign-in did not load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.aetherGis = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in did not load."));
    document.head.appendChild(script);
  });
}

function PanelArt({ scene, wide }: { scene: Scene; wide: boolean }) {
  const line = dialogueWithoutSpeaker(scene);
  const art = scene.imageUrl ? (
    <img src={scene.imageUrl} alt={scene.caption || line || "Panel"} className={wide ? "h-full w-full object-cover" : "aspect-[2/3] w-full object-cover"} />
  ) : (
    <div className={`flex items-end justify-center bg-panel pb-4 ${wide ? "h-full w-full" : "aspect-[2/3] w-full"}`}>
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Not painted</p>
    </div>
  );
  return (
    <figure className="rounded-2xl bg-ink-2 hairline">
      <div className={`relative overflow-hidden rounded-t-2xl bg-ink ${wide ? "aspect-video" : ""}`}>
        {art}
        {scene.sfx ? (
          <p className={`sfx-hit pointer-events-none absolute top-3 left-3 z-10 font-display text-cinnabar italic ${wide ? "text-3xl" : "text-5xl"}`}>{scene.sfx}</p>
        ) : null}
      </div>
      {line ? (
        <div className="mx-3 mt-3 rounded-2xl bg-paper px-4 py-3 text-ink">
          {scene.speaker ? <p className="mb-1.5 text-xs font-semibold tracking-widest text-seal uppercase">{scene.speaker}</p> : null}
          <p className="font-display text-lg leading-snug break-words text-ink">{line}</p>
        </div>
      ) : null}
      {scene.caption ? <p className="px-4 pt-3 pb-4 text-sm leading-relaxed break-words text-paper">{scene.caption}</p> : <div className="h-3" />}
    </figure>
  );
}

export function StudioApp() {
  const [tab, setTab] = useState<Tab>("story");
  const [project, setProject] = useState<Project>(SAMPLE);
  const [draft, setDraft] = useState(SAMPLE_TEXT);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCell, setShowCell] = useState(false);
  const [track, setTrack] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerToken, setWorkerToken] = useState("");
  const [provider, setProvider] = useState<CloudProvider>("zai");
  const [modelId, setModelId] = useState(defaultModel("zai"));
  const [customModel, setCustomModel] = useState("");
  const [customBase, setCustomBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [apiBadge, setApiBadge] = useState<string | null>(null);
  const [workerBadge, setWorkerBadge] = useState<string | null>(null);
  const [localModel, setLocalModel] = useState<LocalMode>("gguf");
  const [duty, setDuty] = useState<Duty>("split");
  const [imageRepo, setImageRepo] = useState("");
  const [language, setLanguage] = useState<"hi" | "en">("en");
  const [masters, setMasters] = useState<{ en: boolean; hi: boolean }>({ en: false, hi: false });
  const [previewSeen, setPreviewSeen] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [retries, setRetries] = useState("3");
  const [colabUrl, setColabUrl] = useState("");
  const [kaggleUrl, setKaggleUrl] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [sourceCookie, setSourceCookie] = useState("");
  const [bibleBefore, setBibleBefore] = useState("40");
  const [bibleAfter, setBibleAfter] = useState("20");
  const [bible, setBible] = useState("");
  const [channels, setChannels] = useState<{ en: ChannelSlot; hi: ChannelSlot }>({ en: EMPTY_SLOT, hi: EMPTY_SLOT });
  const [chatLog, setChatLog] = useState<{ role: "user" | "studio"; text: string }[]>([
    {
      role: "studio",
      text: "Ask about a look, a line, or the two channels. Changing English or Hindi only re-voices. Pictures stay.",
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [playAt, setPlayAt] = useState(0);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [ytClientId, setYtClientId] = useState("");
  const [ytToken, setYtToken] = useState("");
  const [ytEmail, setYtEmail] = useState("");
  const [ytChannel, setYtChannel] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState(SAMPLE.seo.tags.join(", "));
  const seenTags = useRef(SAMPLE.seo.tags.join("|"));
  const [voiced, setVoiced] = useState<Record<string, true>>({});
  const voiceRun = useRef(0);
  const jobPass = useRef<"assemble" | "revoice">("assemble");
  const jobLanguage = useRef<ReelLanguage>("en");
  const hydrated = useRef(false);

  useEffect(() => {
    wipeLegacySecrets();
    const saved = loadProject();
    if (saved) {
      setProject(saved);
      setDraft(saved.text || SAMPLE_TEXT);
      if (saved.language === "hi" || saved.language === "en") setLanguage(saved.language);
      if (saved.bible) setBible(saved.bible);
      if (saved.aspect === "16:9" || saved.aspect === "9:16") setAspect(saved.aspect);
      if (saved.imageRepo) setImageRepo(saved.imageRepo);
      const flags: Record<string, true> = {};
      for (const scene of saved.scenes) {
        if (hasRequestedVoice(scene.voiceEn, "en")) flags[`${scene.id}:en`] = true;
        if (hasRequestedVoice(scene.voiceHi, "hi")) flags[`${scene.id}:hi`] = true;
      }
      setVoiced(flags);
      setTagDraft((saved.seo?.tags || []).join(", "));
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveProject({ ...project, imageRepo: imageRepo.trim() || project.imageRepo });
  }, [project, imageRepo]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const preset = PROVIDER_PRESETS[provider];
  function voiceFor(next: ReelLanguage) {
    return next === "hi" ? "hi-IN-MadhurNeural" : "en-US-ChristopherNeural";
  }
  const voice = voiceFor(language);
  const filmSrc = masterSrc(workerUrl, workerToken, language);

  function session() {
    return {
      provider,
      model: customModel.trim() || modelId,
      apiKey: apiKey.trim(),
      customBaseUrl: customBase.trim(),
      workerUrl: workerUrl.trim(),
      workerToken: workerToken.trim(),
      localModel,
      language,
      duty,
    };
  }

  type SourcePanel = { src: string; text: string; bubble?: string; aside?: string };

  async function readBubbles(panels: SourcePanel[]): Promise<SourcePanel[]> {
    const next = panels.map((panel) => ({ ...panel }));
    if (!workerUrl.trim()) return next;
    const indexed = next
      .map((panel, index) => ({ panel, index }))
      .filter((row) => /^https?:\/\//i.test(row.panel.src));
    if (!indexed.length) return next;
    for (let start = 0; start < indexed.length; start += 8) {
      const batch = indexed.slice(start, start + 8);
      setBusy(`Reading bubbles ${start + 1}–${start + batch.length} of ${indexed.length}`);
      try {
        const result = await readPanelText({
          data: {
            images: batch.map((row) => ({ id: `p${row.index}`, url: row.panel.src })),
            ...session(),
          },
        });
        if (!result.ok) {
          setNotice(`${result.error} Nearby page text is kept.`);
          break;
        }
        for (const row of result.panels) {
          const index = Number(row.id.slice(1));
          const target = next[index];
          if (!target || !Number.isInteger(index)) continue;
          if (row.bubble.trim()) target.bubble = row.bubble.trim();
          if (row.aside.trim()) target.aside = row.aside.trim();
          const spoken = [target.bubble, target.aside].filter(Boolean).join(" ").trim();
          if (spoken) target.text = spoken;
        }
      } catch {
        setNotice("Bubble reading stopped. Nearby page text is kept.");
        break;
      }
    }
    return next;
  }

  async function writeMissingPrompts(source: Project): Promise<Project | null> {
    const pendingIds = new Set(beatsNeedingPrompt(source.scenes));
    const pending = source.scenes.filter((scene) => pendingIds.has(scene.id) && !scene.imagePrompt.trim());
    if (!pending.length) return source;
    let current = source;
    for (let index = 0; index < pending.length; index += 1) {
      const scene = pending[index];
      if (!scene) continue;
      setBusy(`Writing prompt ${index + 1} of ${pending.length}. One beat, then the next. No picture yet.`);
      try {
        const result = await writeBeatPrompt({
          data: {
            caption: scene.caption,
            dialogue: scene.dialogue,
            speaker: scene.speaker,
            state: scene.state,
            chapter: scene.chapter || 0,
            lock: lookLockForScene(scene, current.characters),
            ...session(),
          },
        });
        if (!result.ok) {
          setError(result.error);
          setBusy(null);
          return null;
        }
        current = {
          ...current,
          scenes: current.scenes.map((item) =>
            item.id === scene.id ? { ...item, imagePrompt: result.prompt, promptLocked: true } : item,
          ),
        };
        setProject(current);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The prompt writer stopped. No picture was drawn.");
        setBusy(null);
        return null;
      }
    }
    return current;
  }

  function patchCast(id: string, patch: Partial<Character>, recompose: boolean) {
    setProject((current) => {
      const characters = current.characters.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch, outfits: patch.outfits ?? item.outfits };
        if (recompose) {
          next.look = composeLook(next);
          next.vessel = next.outfit || next.look;
        }
        return next;
      });
      const structured = characters.some((item) =>
        [item.face, item.hair, item.age, item.scars, item.eyes, item.body, item.outfit, ...(item.outfits ?? []).map((row) => row.outfit)].some((value) => value?.trim()),
      );
      return { ...current, characters, ...(structured ? { bible: bibleDocument(characters) } : {}) };
    });
  }

  function absVoice(path: string): string {
    if (!path) return "";
    if (path.startsWith("data:") || /^https?:\/\//i.test(path)) return path;
    try {
      const target = workerEndpoint(workerUrl, path.startsWith("/api/v1/") ? path : `/api/v1/voices/${path}`);
      if (workerToken.trim()) target.searchParams.set("token", workerToken.trim());
      return target.toString();
    } catch {
      return "";
    }
  }

  function hasRequestedVoice(path: string | undefined, next: ReelLanguage): boolean {
    const slug = next === "hi" ? "hiINMadhurNeural" : "enUSChristopherNeural";
    return Boolean(path?.includes(slug));
  }

  function applyLanguage(next: ReelLanguage, source: Project = project) {
    const shown = { ...withLanguage(rememberScript(source, language), next), voice: voiceFor(next) };
    setLanguage(next);
    setTrack(null);
    setProject(shown);
    setTagDraft(shown.seo.tags.join(", "));
    setNotice("Language change = audio, captions, and SEO only. Pictures stay.");
    return shown;
  }

  function rememberVoice(sceneId: string, next: ReelLanguage, src: string, workerPath?: string) {
    if (src) voiceCache.set(`${sceneId}:${next}`, src);
    setVoiced((current) => ({ ...current, [`${sceneId}:${next}`]: true }));
    if (!workerPath) return;
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, ...(next === "hi" ? { voiceHi: workerPath } : { voiceEn: workerPath }) } : scene,
      ),
    }));
  }

  async function fillVoices(source: Project, next: ReelLanguage, force = false) {
    const pending = source.scenes.filter((scene) => {
      if (!voiceLine(scene, next)) return false;
      const saved = next === "hi" ? scene.voiceHi : scene.voiceEn;
      return !hasRequestedVoice(saved, next) && !voiceCache.has(`${scene.id}:${next}`);
    });
    if (!pending.length) {
      if (force) setNotice("Both voice tracks that exist stay. Nothing was redrawn.");
      return;
    }
    if (!force && pending.length > 8) {
      setNotice("Language change = audio, captions, and SEO only. Pictures stay. Re-voice makes the rest of the male track.");
      return;
    }
    const run = voiceRun.current + 1;
    voiceRun.current = run;
    for (let index = 0; index < pending.length; index += 1) {
      if (voiceRun.current !== run) return;
      const scene = pending[index];
      setBusy(`Re-voicing panel ${index + 1} of ${pending.length}. Pictures stay locked.`);
      try {
        const result = await speakLine({ data: { text: voiceLine(scene, next), voice: voiceFor(next), sceneId: scene.id, ...session(), language: next } });
        if (voiceRun.current !== run) return;
        if (result.ok) {
          const src = result.audioBase64
            ? `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`
            : absVoice(result.audioUrl || "");
          rememberVoice(scene.id, next, src, result.audioUrl);
        }
      } catch {
        if (voiceRun.current !== run) return;
        setNotice("Language change = audio, captions, and SEO only. Pictures stay. One voice line did not start.");
        break;
      }
    }
    if (voiceRun.current === run) {
      setBusy(null);
      setNotice("Language change = audio, captions, and SEO only. Pictures stay.");
    }
  }

  async function onPickLanguage(next: ReelLanguage) {
    if (next === language || busy) return;
    setError(null);
    voiceRun.current += 1;
    const remembered = rememberScript(project, language);
    const missing = missingScript(remembered, next);
    if (missing.length === 0) {
      const shown = applyLanguage(next, remembered);
      setPreviewSeen(false);
      setPreviewBroken(false);
      if (masters[next]) {
        setNotice("Language change = audio, captions, and SEO only. Pictures stay.");
        return;
      }
      if (workerUrl.trim()) void onSendJob("revoice", shown);
      else void fillVoices(shown, next);
      return;
    }
    setPreviewSeen(false);
    setPreviewBroken(false);
    setBusy("Re-voicing. Pictures stay locked.");
    try {
      let current = remembered;
      const pending = current.scenes.filter((scene) => missing.includes(scene.id));
      let narration = "";
      let seoTitle = "";
      let seo: Project["seo"] | null = null;
      for (let index = 0; index < pending.length; index += 30) {
        const batch = pending.slice(index, index + 30);
        setBusy(`Re-voicing lines ${index + 1}–${Math.min(index + 30, pending.length)}. Pictures stay locked.`);
        const result = await translateLines({
          data: {
            target: next,
            lines: batch.map((scene) => ({ id: scene.id, caption: scene.caption, dialogue: scene.dialogue })),
            ...session(),
            language: next,
          },
        });
        if (!result.ok) {
          setError(result.error);
          setBusy(null);
          return;
        }
        current = writeTranslated(current, next, result.lines);
        if (result.narration) narration = result.narration;
        if (result.seo.title) {
          seoTitle = result.seo.title;
          seo = { ...result.seo, privacy: undefined };
        }
      }
      const packed =
        next === "hi"
          ? { ...current, narrationHi: narration || current.narrationHi, seoHi: seoTitle && seo ? seo : current.seoHi }
          : { ...current, narrationEn: narration || current.narrationEn, seoEn: seoTitle && seo ? seo : current.seoEn };
      const shown = applyLanguage(next, packed);
      if (workerUrl.trim()) void onSendJob("revoice", shown);
      else void fillVoices(shown, next);
    } catch (err) {
      setError(err instanceof Error ? `${err.message} Pictures were not touched.` : "Re-voice stopped. Pictures were not touched.");
      setBusy(null);
    }
  }

  function chooseProvider(next: CloudProvider) {
    setProvider(next);
    setModelId(defaultModel(next));
    setCustomModel("");
    setApiBadge(null);
  }

  function stamp(next: Project, hook?: string): Project {
    return {
      ...next,
      source: "grok",
      language,
      voice,
      hook: hook || next.hook || "",
      aspect,
      localModel,
      text: draft,
    };
  }

  async function directText(cleaned: string, lock = bible): Promise<boolean> {
    const chunks = chunkChapterText(cleaned);
    if (!chunks.length) {
      setError("Paste at least a short chapter.");
      return false;
    }
    const parts: Project[] = [];
    const call = session();
    for (let index = 0; index < chunks.length; index += 1) {
      setBusy(chunks.length > 1 ? `Directing part ${index + 1} of ${chunks.length}` : "Directing the manhua explanation");
      const result = await directChapter({ data: { text: chunks[index], lock, ...call } });
      if (!result.ok) {
        setError(chunks.length > 1 ? `Part ${index + 1}: ${result.error}` : result.error);
        return false;
      }
      parts.push({
        ...result.direction,
        source: "grok",
        text: chunks[index],
        hook: result.direction.hook,
      });
      if (result.via === "local") setNotice("Cloud missed. Shifted to the connected Colab/Kaggle model.");
    }
    const merged = rememberScript(keepPrivacy(mergeCuts(parts), project), language);
    const cast = mergeCast(merged.characters, gleanCast(cleaned, merged.characters));
    const doc = (lock || bible).trim() || bibleDocument(cast);
    if (doc) setBible(doc);
    setProject(stamp({ ...merged, characters: cast, bible: doc || merged.bible }, parts.find((part) => part.hook)?.hook));
    setDraft(cleaned);
    setNotice(
      chunks.length > 1
        ? `Explanation written in ${chunks.length} parts. ${merged.scenes.length} panels, no four-panel cap.`
        : `AI Manhua Recap Director wrote ${merged.scenes.length} panels in ${language === "hi" ? "Hindi" : "English"}.`,
    );
    setTab("forge");
    return true;
  }

  async function onDirect() {
    const cleaned = sanitizeNovelText(draft);
    if (cleaned !== draft) setDraft(cleaned);
    setError(null);
    try {
      await directText(cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The director did not answer.");
    } finally {
      setBusy(null);
    }
  }

  async function onFetch() {
    setError(null);
    const wantsRange = rangeStart.trim() !== "" || rangeEnd.trim() !== "";
    const cookie = sourceCookie.trim();
    if (wantsRange) {
      if (rangeStart.trim() === "" || rangeEnd.trim() === "") {
        setError("Set both a start and an end chapter.");
        return;
      }
      const start = Number(rangeStart);
      const end = Number(rangeEnd);
      let urls: string[] = [];
      try {
        urls = expandChapterUrls(url, start, end);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That chapter range is not valid.");
        return;
      }
      const before = Math.min(100, Math.max(0, Number(bibleBefore) || 0));
      const after = Math.min(50, Math.max(0, Number(bibleAfter) || 0));
      const contextUrls: string[] = [];
      try {
        if (before > 0 && start - before >= 1) contextUrls.push(...expandChapterUrls(url, start - before, start - 1));
        else if (before > 0 && start > 1) contextUrls.push(...expandChapterUrls(url, 1, start - 1));
        if (after > 0) contextUrls.push(...expandChapterUrls(url, end + 1, end + after));
      } catch {
        /* a bad context range must not block the chapters the user asked for */
      }
      const fetched: { index: number; title: string; sourceUrl: string; text: string; panels: { src: string; text: string; bubble?: string; aside?: string }[] }[] = [];
      try {
        const allUrls = [...contextUrls, ...urls];
        const pulled = new Map<string, { title: string; text: string; error: string; ok: boolean; panels: { src: string; text: string; bubble?: string; aside?: string }[] }>();
        if (workerUrl.trim() && allUrls.length > 2) {
          setBusy("Sending the chapter range to the worker. This phone is not opening every page.");
          const started = await startWorkerFetch({ data: { urls: allUrls, cookie, ...session() } });
          if (started.ok) {
            for (let attempt = 0; attempt < 90; attempt += 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 1500));
              const status = await workerFetchStatus({ data: { jobId: started.jobId, ...session() } });
              if (!status.ok) break;
              setBusy(status.label || `Worker fetch ${status.progress}%`);
              if (status.status === "error") throw new Error(status.label || "The worker could not finish that fetch.");
              if (status.status === "done") {
                for (const page of status.pages) {
                  pulled.set(page.url, { title: page.title, text: page.text, error: page.error, ok: page.ok && !page.error, panels: page.panels });
                }
                break;
              }
            }
            if (!pulled.size) setNotice("The worker fetch did not return pages. Reading from this phone instead.");
          }
        }
        const contextBits: string[] = [];
        for (let index = 0; index < contextUrls.length; index += 1) {
          const href = contextUrls[index];
          if (!href) continue;
          const cached = pulled.get(href);
          if (cached?.ok) {
            contextBits.push(cached.text);
            continue;
          }
          setBusy(`Reading look context ${index + 1} of ${contextUrls.length}. These pages do not become panels.`);
          const result = await fetchSource({ data: { url: href, cookie } });
          if (result.ok) contextBits.push(result.text);
        }
        const cast = mergeCast(project.characters, gleanCast(contextBits.join("\n"), project.characters));
        const useful = cast.some((character) => character.face || character.hair || character.outfit || character.scars || character.eyes);
        const lock = useful ? bibleDocument(cast) : gleanLooks(contextBits.join("\n"));
        if (lock) setBible(lock);
        if (useful) setProject((current) => ({ ...current, characters: cast, bible: lock }));
        if ((Number(bibleBefore) || 0) > 100 || (Number(bibleAfter) || 0) > 50) {
          setNotice("Look lock was capped at 100 chapters before and 50 after. Those pages never become panels.");
        }
        for (let index = 0; index < urls.length; index += 1) {
          const chapter = start + index;
          const href = urls[index];
          if (!href) continue;
          const cached = pulled.get(href);
          if (cached && !cached.ok) {
            setError(`Chapter ${chapter}: ${cached.error || "The worker could not open that page."}`);
            return;
          }
          if (cached?.ok) {
            fetched.push({
              index: chapter,
              title: sanitizeNovelText(cached.title) || `Chapter ${chapter}`,
              sourceUrl: href,
              text: sanitizeNovelText(cached.text),
              panels: cached.panels,
            });
            continue;
          }
          setBusy(`Reading chapter ${chapter} (${index + 1} of ${urls.length})`);
          const result = await fetchSource({ data: { url: href, cookie } });
          if (!result.ok) {
            setError(`Chapter ${chapter}: ${result.error}`);
            return;
          }
          fetched.push({
            index: chapter,
            title: sanitizeNovelText(result.title) || `Chapter ${chapter}`,
            sourceUrl: href,
            text: sanitizeNovelText(result.text),
            panels: result.panels,
          });
        }
        if (sourceMode === "panels") {
          let panels = fetched.flatMap((chapter) => chapter.panels);
          panels = await readBubbles(panels);
          if (!panels.length) {
            setError("No panel images on those pages. Switch to text mode, or paste the chapter.");
            return;
          }
          const next = rememberScript(panelsProject(fetched[0]?.title || project.title, panels), "en");
          setProject({ ...keepPrivacy(next, project), language, voice, aspect, localModel, bible: lock, characters: useful ? cast : project.characters });
          setNotice(`${panels.length} source panels locked. Bubbles and nearby lines are separate. They will not be redrawn.`);
          setTab("strip");
          return;
        }
        const combined = fetched.map((chapter) => `${chapter.title}\n\n${chapter.text}`).join("\n\n");
        if (containsHan(combined) || lock) {
          setDraft(combined);
          setBible(lock);
          setNotice(lock ? "Look lock saved from nearby chapters. Directing the selected range only." : "Chinese text pulled. Translating into the explanation script.");
          await directText(combined, lock);
          return;
        }
        const next = keepPrivacy(projectFromChapters(fetched), project);
        setProject({ ...rememberScript({ ...next, language, voice, aspect, localModel, bible: lock, characters: useful ? mergeCast(next.characters, cast) : next.characters }, language) });
        setDraft(next.text);
        setNotice(`${fetched.length} chapters fetched. Run the director to write the explanation. Pictures are not made yet.`);
        setTab("story");
      } catch (err) {
        setError(err instanceof Error ? err.message : "The chapter range did not load.");
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy("Reading the page");
    try {
      const result = await fetchSource({ data: { url, cookie } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (sourceMode === "panels") {
        if (!result.panels.length) {
          setError("No panel images on that page. Switch to text mode, or paste the chapter.");
          return;
        }
        const panels = await readBubbles(result.panels);
        const next = rememberScript(panelsProject(result.title || "Source panels", panels), "en");
        setProject({ ...keepPrivacy(next, project), language, voice, aspect, localModel });
        setNotice(`${panels.length} source panels locked. Bubble lines and text near the face stay separate. Nothing is redrawn.`);
        setTab("strip");
        return;
      }
      const text = sanitizeNovelText(result.title ? `${result.title}\n\n${result.text}` : result.text);
      setDraft(text);
      if (containsHan(text)) {
        setNotice("Chinese chapter pulled. Translating it into the explanation.");
        await directText(text);
        return;
      }
      setNotice("Page text is in the script. Ads and nav were stripped. Direct it when you want the explanation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The page did not load.");
    } finally {
      setBusy(null);
    }
  }

  async function onPaint(onlyId?: string) {
    setError(null);
    const prepared = await writeMissingPrompts(project);
    if (!prepared) return;
    const targets = prepared.scenes.filter((scene) => {
      if (scene.locked) return false;
      if (onlyId) return scene.id === onlyId;
      return !scene.imageUrl;
    });
    if (!targets.length) {
      setNotice(prepared.scenes.some((scene) => scene.locked) ? "Source panels stay as they are. Nothing was redrawn." : "The open panels are already painted.");
      setBusy(null);
      return;
    }
    const call = session();
    let cursor = prepared;
    let usedFallback = false;
    for (let index = 0; index < targets.length; index += 1) {
      const scene = cursor.scenes.find((item) => item.id === targets[index]?.id) ?? targets[index];
      if (!scene) continue;
      let accepted: string | null = null;
      let note = "";
      const tries = Math.min(3, Math.max(1, Number(retries) || 3));
      for (let attempt = 1; attempt <= tries; attempt += 1) {
        setBusy(
          attempt === 1
            ? `Painting panel ${index + 1} of ${targets.length}`
            : `Panel ${index + 1} did not match. Retry ${attempt} of ${tries}. Later panels are waiting.`,
        );
        try {
          const lock = lookLockForScene(scene, cursor.characters);
          const result = await paintPanel({
            data: {
              prompt: [scene.imagePrompt, lock].filter(Boolean).join("\n"),
              reference: faceReferenceFor(scene, cursor.characters),
              repo: imageRepo.trim(),
              ...call,
            },
          });
          if (!result.ok) {
            setError(result.error);
            setBusy(null);
            return;
          }
          if (result.fallback) usedFallback = true;
          const check = await checkPanel({ data: { prompt: scene.imagePrompt, imageUrl: result.url, ...call } });
          if (check.ok && check.match === "no" && attempt < tries) {
            note = check.note || "Face or scene did not match.";
            continue;
          }
          accepted = result.url;
          note = check.ok ? check.note : "";
          if (check.ok && check.match === "no") note = note || `Still off after ${tries} tries.`;
          break;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Painting stopped.");
          setBusy(null);
          return;
        }
      }
      if (!accepted) {
        setError("That panel failed three times. The queue is stopped. Pictures already accepted were kept.");
        setBusy(null);
        return;
      }
      const failed = note.startsWith("Still off");
      const mentioned = cursor.characters.filter((character) =>
        [scene.caption, scene.dialogue, scene.speaker, scene.imagePrompt].join("\n").includes(character.name),
      );
      const faceOwner = mentioned.length === 1 ? mentioned[0] : undefined;
      cursor = {
        ...cursor,
        characters: cursor.characters.map((character) => {
          if (character.faceUrl || !faceOwner || character.id !== faceOwner.id) return character;
          return { ...character, faceUrl: accepted };
        }),
        scenes: cursor.scenes.map((item) =>
          item.id === scene.id ? { ...item, imageUrl: accepted, checkNote: note, retries: failed ? tries : item.retries } : item,
        ),
      };
      setProject(cursor);
      if (failed) {
        setError(`${note} Fix the prompt or retry this panel. The queue is stopped so the next picture does not start on a bad face.`);
        setBusy(null);
        setTab("strip");
        return;
      }
    }
    setBusy(null);
    setNotice(usedFallback ? "Free fallback painter finished one panel at a time. Faces can drift. Your Colab checkpoint is the real one. Connect the worker so the vision check can run." : "Panels painted one at a time. The first accepted face is kept as a reference.");
    setTab("strip");
  }

  useEffect(() => {
    setTrack(voiceCache.get(`narration:${language}`) ?? null);
  }, [project.narration, language]);

  async function onSpeak() {
    setError(null);
    primeSpeechUnlock();
    if (track) {
      try {
        await new Audio(track).play();
        setNotice("Played the saved voice.");
      } catch {
        setError("The track is ready, but this phone blocked playback. Tap again.");
      }
      return;
    }
    const text = sanitizeNovelText(project.narration) || project.narration;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const speech = { state: "failed" as "reading" | "failed" | "done" };
    if (synth) {
      speech.state = "reading";
      const known = synth.getVoices();
      void speakOnDevice(text, chooseVoice(known, text)).then(
        () => {
          speech.state = "done";
        },
        () => {
          speech.state = "failed";
        },
      );
    }
    setBusy("Reading the chapter");
    try {
      const result = await speakLine({ data: { text, voice, ...session() } });
      if (result.ok) {
        synth?.cancel();
        const src = `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`;
        voiceCache.set(`narration:${language}`, src);
        setVoiced((current) => ({ ...current, [`narration:${language}`]: true }));
        setTrack(src);
        try {
          await new Audio(src).play();
          setNotice(`Played ${voice}.`);
        } catch {
          setNotice("The voice track is ready. Tap Read again to play it.");
        }
        return;
      }
      if (speech.state !== "failed") {
        setNotice("Reading on this phone.");
        return;
      }
      const voices = await loadVoices(1200);
      try {
        await speakOnDevice(text, chooseVoice(voices, text));
        setNotice("Reading on this phone.");
      } catch {
        setError("Voice did not start. Tap Read again.");
      }
    } catch (err) {
      if (speech.state !== "failed") {
        setNotice("Reading on this phone.");
        return;
      }
      setError(err instanceof Error ? err.message : "The reading stopped.");
    } finally {
      setBusy(null);
    }
  }

  async function onCopy(value: string, label: string) {
    const ok = await copyText(value);
    setNotice(ok ? `${label} copied.` : `Could not copy ${label.toLowerCase()} on this phone.`);
  }

  async function onVerifyApi() {
    setBusy("Verifying the API");
    setError(null);
    setApiBadge(null);
    try {
      const result = await verifyCloud({ data: session() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApiBadge(result.badge);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The API check failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onTestConnection(target?: string) {
    const href = (target || workerUrl).trim();
    setBusy("Testing the worker");
    setError(null);
    setWorkerBadge(null);
    try {
      const result = await testWorker({ data: { url: href, token: workerToken } });
      if (!result.ok) {
        setError(result.body ? `${result.error} ${result.body}` : result.error);
        return;
      }
      if (target && target !== workerUrl) setWorkerUrl(target);
      setWorkerBadge("Connection Done — Local AI & GPU Worker Active");
      setNotice("Worker health answered.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The worker did not answer.");
    } finally {
      setBusy(null);
    }
  }

  function packetNow(pass: "assemble" | "revoice" = "assemble", source: Project = project) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const active = source.language === "hi" || source.language === "en" ? source.language : language;
    return jobPacket(
      projectWithAbsoluteArt(
        { ...source, language: active, voice: source.voice || EXPLAIN_VOICES[active], aspect, localModel, imageRepo: imageRepo.trim() || source.imageRepo, hook: source.hook },
        origin,
      ),
      pass,
    );
  }

  async function onSendJob(pass: "assemble" | "revoice" = "assemble", source?: Project) {
    jobPass.current = pass;
    const active = source?.language === "hi" || source?.language === "en" ? source.language : language;
    jobLanguage.current = active;
    setBusy(pass === "revoice" ? "Re-voicing. Pictures stay locked." : "Rendering the explanation video");
    setError(null);
    setWatchUrl(null);
    try {
      const result = await submitJob({ data: { url: workerUrl, token: workerToken, packet: packetNow(pass, source) } });
      if (!result.ok) {
        setError(pass === "revoice" ? `${result.error} Pictures were not touched.` : result.error);
        return;
      }
      if (result.jobId) {
        setJob({
          id: result.jobId,
          status: "queued",
          progress: 0,
          label: pass === "revoice" ? "Re-voicing" : "Accepted",
          error: "",
          mp4Url: null,
          timing: {},
          voices: {},
        });
        setNotice(pass === "revoice" ? "Worker is re-voicing the same pictures. Audio and captions only." : `Worker accepted the film. Watching job ${result.jobId}.`);
        setTab("bay");
      } else {
        setJob(null);
        setNotice("Worker accepted the packet, but the reply had no job id.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The worker did not take the job.");
    } finally {
      setBusy(null);
    }
  }

  const jobTerminal = !job || job.status === "done" || job.status === "error";

  useEffect(() => {
    if (!job?.id || jobTerminal || !workerUrl.trim()) return;
    const id = job.id;
    let stop = false;
    const tick = async () => {
      try {
        const result = await jobStatus({ data: { url: workerUrl, token: workerToken, jobId: id } });
        if (stop) return;
        if (!result.ok) {
          setJob((current) => (current && current.id === id ? { ...current, status: "error", error: result.error } : current));
          return;
        }
        const nextJob = { ...result.job, label: shownLabel(result.job.label, jobPass.current) };
        setJob(nextJob);
        if (nextJob.status === "done") {
          const slot = jobLanguage.current;
          setMasters((current) => ({ ...current, [slot]: true }));
          if (Object.keys(nextJob.timing).length || Object.keys(nextJob.voices).length) {
            setProject((current) => applyWorkerAssets(current, nextJob.timing, nextJob.voices, slot));
            setVoiced((current) => {
              const marked = { ...current };
              for (const id of Object.keys(nextJob.voices)) marked[`${id}:${slot}`] = true;
              return marked;
            });
          }
        }
      } catch (err) {
        if (stop) return;
        setJob((current) =>
          current && current.id === id
            ? { ...current, status: "error", error: err instanceof Error ? err.message : "The status check stopped." }
            : current,
        );
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [job?.id, jobTerminal, workerUrl, workerToken]);

  async function onPreview() {
    setBusy("Loading the 6 second preview");
    setError(null);
    try {
      const res = await fetch("/api/studio/mp4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "preview", url: workerUrl, token: workerToken, jobId: job?.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "The preview did not load.");
        return;
      }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setNotice("Six second preview is in the player. The full file stayed on the worker.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The preview did not load.");
    } finally {
      setBusy(null);
    }
  }

  async function onConnectYoutube() {
    const clientId = ytClientId.trim();
    if (!clientId) {
      setError("Paste the Google OAuth client id first. It stays in this tab only.");
      return;
    }
    setError(null);
    setBusy("Opening Google");
    try {
      await loadGis();
      const google = googleAccounts();
      if (!google) throw new Error("Google sign-in did not load.");
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly openid email",
        callback: (resp) => {
          if (!resp.access_token) {
            setError(resp.error || "Google did not return a token.");
            setBusy(null);
            return;
          }
          setYtToken(resp.access_token);
          const slot = language;
          setChannels((current) => ({
            ...current,
            [slot]: {
              token: resp.access_token || "",
              email: current[slot].email,
              channel: current[slot].channel,
            },
          }));
          void (async () => {
            try {
              const [channelRes, userRes] = await Promise.all([
                fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
                  headers: { Authorization: `Bearer ${resp.access_token}` },
                }),
                fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                  headers: { Authorization: `Bearer ${resp.access_token}` },
                }),
              ]);
              const channelJson = (await channelRes.json()) as { items?: { snippet?: { title?: string } }[] };
              const userJson = (await userRes.json()) as { email?: string };
              setYtChannel(channelJson.items?.[0]?.snippet?.title || "");
              setYtEmail(userJson.email || "");
              setChannels((current) => ({
                ...current,
                [slot]: {
                  token: resp.access_token || "",
                  email: userJson.email || "",
                  channel: channelJson.items?.[0]?.snippet?.title || "",
                },
              }));
              setNotice(
                slot === "hi"
                  ? "Hindi channel connected. Upload sends the Hindi master. Pictures are not redrawn."
                  : "English channel connected. Upload sends the English master.",
              );
            } catch {
              setNotice("Token received. Channel details did not load.");
            } finally {
              setBusy(null);
            }
          })();
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google did not open.");
      setBusy(null);
    }
  }

  async function onUpload() {
    if (!job || job.status !== "done") {
      setError("Render the video on the worker, then scrub the preview. The full film stays there.");
      return;
    }
    if (!previewSeen && !previewUrl) {
      setError("Scrub the preview first. Nothing uploads until you have watched it.");
      return;
    }
    const slotToken = channels[language].token || ytToken;
    if (!slotToken) {
      setError(language === "hi" ? "Connect the Hindi YouTube channel first." : "Connect the English YouTube channel first.");
      return;
    }
    setBusy("Uploading from the worker");
    setError(null);
    const tags = parseTags(tagDraft);
    try {
      const result = await uploadYoutube({
        data: {
          url: workerUrl,
          token: workerToken,
          jobId: job.id,
          accessToken: slotToken,
          title: project.seo.title,
          description: [project.seo.description, project.seo.hashtags].filter(Boolean).join("\n\n"),
          tags,
          privacy: youtubePrivacy(project.seo.privacy),
          language,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWatchUrl(result.watchUrl);
      setNotice("Uploaded. The watch link is below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload did not finish.");
    } finally {
      setBusy(null);
    }
  }

  async function onChat() {
    const message = chatDraft.trim();
    if (!message) return;
    setChatDraft("");
    setChatLog((current) => [...current, { role: "user", text: message }]);
    setBusy("Asking the studio AI");
    setError(null);
    try {
      const beats = project.scenes
        .slice(0, 40)
        .map((scene) => `${scene.id}: ${voiceLine(scene, language).slice(0, 90)}`)
        .join("\n");
      const names = project.characters.map((character) => character.name).filter(Boolean).join(", ");
      const context = `${project.title}. Language ${language}. ${project.scenes.length} panels. Pictures stay on a language switch. Cast: ${names || "none"}.\nBeats:\n${beats}\n${project.bible ? `Look lock: ${project.bible.slice(0, 500)}` : ""}`;
      const result = await chatTurn({ data: { message, context, ...session() } });
      if (!result.ok) {
        setChatLog((current) => [...current, { role: "studio", text: result.error }]);
        return;
      }
      setChatLog((current) => [...current, { role: "studio", text: result.reply }]);
      if (result.action?.type === "line") {
        const action = result.action;
        const exists = project.scenes.some((scene) => scene.id === action.id);
        if (!exists) {
          setNotice(`No beat ${action.id}. The line was not changed.`);
        } else {
          setProject((current) => ({
            ...current,
            scenes: current.scenes.map((scene) => {
              if (scene.id !== action.id) return scene;
              const next = { ...scene, caption: action.text, dialogue: "" };
              if (language === "hi") return { ...next, captionHi: action.text, dialogueHi: "", lineHi: action.text };
              return { ...next, captionEn: action.text, dialogueEn: "", lineEn: action.text };
            }),
          }));
          setNotice(`Beat ${action.id} updated. Pictures were not redrawn.`);
        }
      }
      if (result.action?.type === "look") {
        const action = result.action;
        const known = project.characters.some((character) => character.name.toLowerCase() === action.name.toLowerCase());
        if (!known) {
          setNotice(`No character named ${action.name}. The look was not changed.`);
        } else {
          setProject((current) => {
            const characters = current.characters.map((character) =>
              character.name.toLowerCase() === action.name.toLowerCase() ? applyLookPatch(character, action) : character,
            );
            return { ...current, characters, bible: bibleDocument(characters) };
          });
          setNotice(`${action.name} look updated. Pictures were not redrawn.`);
        }
      }
    } catch (err) {
      setChatLog((current) => [
        ...current,
        { role: "studio", text: err instanceof Error ? err.message : "The assistant did not answer." },
      ]);
    } finally {
      setBusy(null);
    }
  }

  async function onPlayPanels() {
    setError(null);
    primeSpeechUnlock();
    const scenes = project.scenes;
    if (!scenes.length) return;
    for (let index = playAt; index < scenes.length; index += 1) {
      setPlayAt(index);
      const scene = scenes[index];
      if (!scene) break;
      const line = voiceLine(scene, language);
      const key = `${scene.id}:${language}`;
      const savedPath = language === "hi" ? scene.voiceHi : scene.voiceEn;
      const cached = voiceCache.get(key) || (savedPath && hasRequestedVoice(savedPath, language) ? absVoice(savedPath) : "");
      if (cached) {
        try {
          await new Audio(cached).play();
        } catch {
          setError("Playback was blocked. Tap Play again.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        continue;
      }
      setBusy(`Reading panel ${index + 1} of ${scenes.length}`);
      try {
        const result = await speakLine({ data: { text: line, voice, sceneId: scene.id, ...session() } });
        if (result.ok) {
          const src = result.audioBase64
            ? `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`
            : absVoice(result.audioUrl || "");
          rememberVoice(scene.id, language, src, result.audioUrl);
          if (src) await new Audio(src).play();
        } else {
          await speakOnDevice(line, null);
        }
      } catch {
        try {
          await speakOnDevice(line, null);
        } catch {
          setError("Voice did not start. Pictures were not touched.");
          setBusy(null);
          return;
        }
      }
    }
    setBusy(null);
    setNotice("Preview played the saved pictures with this language only.");
  }

  function patchScene(id: string, patch: Partial<Scene>) {
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== id) return scene;
        const nextScene = { ...scene, ...patch };
        const line = [nextScene.caption, nextScene.dialogue].filter(Boolean).join(" ").trim();
        if (language === "hi") return { ...nextScene, captionHi: nextScene.caption, dialogueHi: nextScene.dialogue, lineHi: line };
        return { ...nextScene, captionEn: nextScene.caption, dialogueEn: nextScene.dialogue, lineEn: line };
      }),
    }));
  }

  const tabs: { id: Tab; label: string; icon: typeof ScrollText }[] = [
    { id: "story", label: "Source", icon: ScrollText },
    { id: "strip", label: "Beats", icon: Clapperboard },
    { id: "forge", label: "Cast", icon: Sparkles },
    { id: "chat", label: "Chat", icon: MessageCircle },
    { id: "bay", label: "Video", icon: Factory },
    { id: "youtube", label: "Upload", icon: Youtube },
  ];

  const tagsKey = project.seo.tags.join("|");
  useEffect(() => {
    if (seenTags.current === tagsKey) return;
    seenTags.current = tagsKey;
    setTagDraft(project.seo.tags.join(", "));
  }, [tagsKey]);

  return (
    <main className="mx-auto min-h-dvh max-w-lg">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-ink/95 px-4 py-3 backdrop-blur">
        <img src="/favicon.svg" alt="" className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-cinnabar">AETHER STUDIO</p>
          <h1 className="truncate text-xl text-paper">{project.title}</h1>
        </div>
        <p className="ml-auto shrink-0 rounded-full bg-panel px-3 py-1 text-xs text-muted">{sourceLabel(project.source)}</p>
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={showSettings}
          onClick={() => setShowSettings((open) => !open)}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full ${showSettings ? "bg-seal text-paper" : "bg-panel text-paper"}`}
        >
          <Settings className="size-5" aria-hidden />
        </button>
      </header>

      {busy ? (
        <div className="px-4">
          <p className="text-sm text-paper">{busy}</p>
          <div className="mt-2 h-0.5 overflow-hidden bg-line">
            <div className="grow-bar h-full bg-cinnabar" />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-2xl bg-panel px-4 py-3 text-sm text-paper">
          {error}
        </p>
      ) : null}
      {notice && !error ? <p className="mx-4 mt-3 text-sm text-muted">{notice}</p> : null}

      <div className="screen-pad px-4 pt-4">
        {showSettings ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Settings</h2>
              <p className="mt-2 text-sm text-muted">
                Keys, tokens, notebook links, and the YouTube token live in this tab’s memory only. Refresh clears them. Nothing is written to storage.
              </p>
            </div>
            <label className="block" htmlFor="ai-provider">
              <span className="text-sm font-medium text-paper">AI provider</span>
              <select id="ai-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as CloudProvider)} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base">
                {PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_PRESETS[id].label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">{preset.hint}</span>
            </label>
            {preset.models.length ? (
              <label className="block" htmlFor="ai-model">
                <span className="text-sm font-medium text-paper">Model</span>
                <select id="ai-model" value={modelId} onChange={(event) => { setModelId(event.target.value); setApiBadge(null); }} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base">
                  {preset.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block" htmlFor="custom-model">
              <span className="text-sm font-medium text-paper">Model ID</span>
              <input
                id="custom-model"
                value={customModel}
                onChange={(event) => {
                  setCustomModel(event.target.value);
                  setApiBadge(null);
                }}
                placeholder={modelId || "glm-5.2"}
                autoComplete="off"
                spellCheck={false}
                className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none"
              />
              <span className="mt-1 block text-xs text-muted">Any id overrides the list. Leave this empty to use the selected model.</span>
            </label>
            {provider === "custom" ? (
              <label className="block" htmlFor="custom-base">
                <span className="text-sm font-medium text-paper">OpenAI-compatible base URL</span>
                <input id="custom-base" value={customBase} onChange={(event) => setCustomBase(event.target.value)} placeholder="https://host/v1" inputMode="url" autoComplete="off" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
              </label>
            ) : null}
            <label className="block" htmlFor="api-key">
              <span className="flex items-center justify-between gap-3 text-sm font-medium text-paper">
                API key {provider === "github" ? "(GitHub PAT)" : ""}
                <button type="button" onClick={() => setRevealKey((open) => !open)} className="text-xs font-semibold text-cinnabar">
                  {revealKey ? "Hide" : "Show"}
                </button>
              </span>
              <input
                id="api-key"
                type={revealKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => { setApiKey(event.target.value); setApiBadge(null); }}
                placeholder={provider === "github" ? "ghp_… or github_pat_…" : "Paste a key. It is not saved."}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none"
              />
            </label>
            <button type="button" onClick={onVerifyApi} disabled={!!busy || !apiKey.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Verify & Connect API
            </button>
            {apiBadge ? <p className="badge-ok rounded-xl px-3 py-2 text-sm font-semibold">{apiBadge}</p> : null}
            <label className="block" htmlFor="local-mode">
              <span className="text-sm font-medium text-paper">Local model if the cloud key is missing or limited</span>
              <select id="local-mode" value={localModel} onChange={(event) => setLocalModel(event.target.value as LocalMode)} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base">
                {LOCAL_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-paper">Explanation & voiceover language</legend>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <button type="button" aria-pressed={language === "hi"} onClick={() => void onPickLanguage("hi")} className={`min-h-12 rounded-xl px-3 text-left text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Hindi re-voice · hi-IN-MadhurNeural
                </button>
                <button type="button" aria-pressed={language === "en"} onClick={() => void onPickLanguage("en")} className={`min-h-12 rounded-xl px-3 text-left text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  English re-voice · en-US-ChristopherNeural
                </button>
              </div>
            </fieldset>
            <label className="block" htmlFor="retry-count">
              <span className="text-sm font-medium text-paper">Vision retries per panel</span>
              <input id="retry-count" value={retries} onChange={(event) => setRetries(event.target.value)} inputMode="numeric" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-paper">Frame</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["9:16", "16:9"] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={aspect === option} onClick={() => setAspect(option)} className={`min-h-12 rounded-xl text-sm font-semibold ${aspect === option ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                    {option === "9:16" ? "9:16 vertical" : "16:9 wide"}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-paper">Who writes, who draws</legend>
              <div className="mt-2 grid grid-cols-1 gap-2">
                {(
                  [
                    ["split", "Split — key writes and checks. Worker draws, speaks, and cuts."],
                    ["worker", "Worker does the writing too."],
                    ["key", "Key only for text. Pictures use the free fallback if no worker draw is allowed."],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={duty === id} onClick={() => setDuty(id)} className={`min-h-12 rounded-xl px-3 text-left text-sm font-semibold ${duty === id ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Default is split. A language switch still does not redraw.</p>
            </fieldset>
            <label className="block" htmlFor="image-repo">
              <span className="text-sm font-medium text-paper">Image checkpoint</span>
              <input id="image-repo" value={imageRepo} onChange={(event) => setImageRepo(event.target.value)} placeholder="cagliostrolab/animagine-xl-3.1 or a Flux repo" autoComplete="off" spellCheck={false} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
              <span className="mt-1 block text-xs text-muted">Empty keeps the worker default. A repo name with “flux” loads Flux and can use the saved face. If that model cannot load, Pollinations runs, then a simple ink drawing. Faces can drift on the fallback.</span>
            </label>
            <label className="block" htmlFor="worker-url">
              <span className="text-sm font-medium text-paper">Live worker URL</span>
              <input id="worker-url" value={workerUrl} onChange={(event) => { setWorkerUrl(event.target.value); setWorkerBadge(null); }} placeholder="https://….trycloudflare.com" inputMode="url" autoComplete="off" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
            </label>
            <label className="block" htmlFor="worker-token">
              <span className="text-sm font-medium text-paper">Worker token</span>
              <input id="worker-token" type="password" value={workerToken} onChange={(event) => setWorkerToken(event.target.value)} autoComplete="off" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <button type="button" onClick={() => onTestConnection()} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Test & Connect
            </button>
            {workerBadge ? <p className="badge-ok rounded-xl px-3 py-2 text-sm font-semibold">{workerBadge}</p> : null}
            <BenchLinks
              colabUrl={colabUrl}
              kaggleUrl={kaggleUrl}
              onColab={setColabUrl}
              onKaggle={setKaggleUrl}
              onTest={(value) => onTestConnection(/trycloudflare\.com|ngrok/i.test(value) ? value : workerUrl)}
              busy={!!busy}
              badge={workerBadge}
            />
          </section>
        ) : null}

        {!showSettings && tab === "story" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Explain the chapter</h2>
              <p className="mt-2 text-sm text-muted">
                Chinese from WTR-LAB is translated by the active model into a Hindi or English manhua explanation. Nothing is stored on this phone.
              </p>
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-paper">Explanation & voiceover language</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={language === "hi"} onClick={() => void onPickLanguage("hi")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Hindi
                </button>
                <button type="button" aria-pressed={language === "en"} onClick={() => void onPickLanguage("en")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  English
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">Language change = audio, captions, and SEO only. Pictures stay.</p>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-paper">Source</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={sourceMode === "text"} onClick={() => setSourceMode("text")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${sourceMode === "text" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Text only
                </button>
                <button type="button" aria-pressed={sourceMode === "panels"} onClick={() => setSourceMode("panels")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${sourceMode === "panels" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Picture manhua
                </button>
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-medium text-paper">Chapter script</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  if (!pasted) return;
                  event.preventDefault();
                  const start = event.currentTarget.selectionStart ?? draft.length;
                  const end = event.currentTarget.selectionEnd ?? draft.length;
                  setDraft(sanitizeNovelText(`${draft.slice(0, start)}${pasted}${draft.slice(end)}`));
                }}
                className="field mt-2 min-h-72 w-full rounded-2xl px-4 py-3 text-base outline-none"
                spellCheck
              />
            </label>
            <button type="button" onClick={onDirect} disabled={!!busy} className="min-h-14 w-full rounded-2xl bg-seal px-3 text-sm font-semibold text-paper disabled:opacity-50">
              AI Manhua Recap Director (GLM-5.2)
            </button>
            <button type="button" onClick={() => { setProject(SAMPLE); setDraft(SAMPLE_TEXT); setNotice("Sample restored."); }} className="min-h-11 w-full text-sm font-semibold text-cinnabar">
              Restore sample
            </button>
            <div className="rounded-2xl bg-ink-2 p-4">
              <label className="block text-sm font-medium text-paper" htmlFor="source-url">
                Chapter link
              </label>
              <input id="source-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://wtr-lab.com/…/chapter-1" inputMode="url" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block text-sm text-paper" htmlFor="chapter-start">
                  Start
                  <input id="chapter-start" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} inputMode="numeric" placeholder="1" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
                </label>
                <label className="block text-sm text-paper" htmlFor="chapter-end">
                  End
                  <input id="chapter-end" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} inputMode="numeric" placeholder="12" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block text-sm text-paper" htmlFor="bible-before">
                  Chapters before (look only)
                  <input id="bible-before" value={bibleBefore} onChange={(event) => setBibleBefore(event.target.value)} inputMode="numeric" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
                </label>
                <label className="block text-sm text-paper" htmlFor="bible-after">
                  Chapters after (look only)
                  <input id="bible-after" value={bibleAfter} onChange={(event) => setBibleAfter(event.target.value)} inputMode="numeric" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
                </label>
              </div>
              <label className="mt-3 block text-sm text-paper" htmlFor="source-cookie">
                Site cookie, only if the page is behind your login
                <input id="source-cookie" value={sourceCookie} onChange={(event) => setSourceCookie(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste the cookie from a tab you are logged into" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
              </label>
              <p className="mt-2 text-xs text-muted">Passwords are never asked. The cookie is sent only with that fetch and is not saved. Nearby chapters lock the character look and are not turned into panels.</p>
              <button type="button" onClick={onFetch} disabled={!!busy || !url.trim()} className="mt-3 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                {rangeStart.trim() || rangeEnd.trim() ? "Pull chapter range" : "Pull readable text"}
              </button>
            </div>
            <div className="rounded-2xl bg-ink-2 p-4 text-xs leading-relaxed text-muted">
              <p className="text-sm font-medium text-paper">Hard limits</p>
              <p className="mt-2">This studio directs. Colab or Kaggle grows a long film and draws panels. A multi-hour file stays on the worker, not in the phone.</p>
              <p className="mt-2">Login walls work only with your cookie, and some sites still refuse. Paste the chapter when that happens.</p>
              <p className="mt-2">The picture check is a vision pass, not magic. After the retry count, you decide. Language change = audio, captions, and SEO only. Pictures stay. A longer line holds the same panel longer.</p>
              <p className="mt-2">Copyright stays with you. This is a production tool.</p>
            </div>
          </section>
        ) : null}

        {!showSettings && tab === "forge" ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-3xl text-paper">Soul and vessel</h2>
              <p className="mt-2 text-sm text-muted">{project.hook || project.logline}</p>
            </div>
            <ul className="space-y-3">
              {project.characters.length === 0 ? <li className="text-sm text-muted">No named cast in this cut.</li> : null}
              {project.characters.map((character) => (
                <li key={character.id} className="rounded-2xl bg-ink-2 p-4">
                  <p className="font-display text-2xl text-paper">{character.name}</p>
                  <label className="mt-3 block text-xs font-semibold tracking-widest text-cinnabar uppercase" htmlFor={`soul-${character.id}`}>
                    Soul
                    <textarea id={`soul-${character.id}`} value={character.soul} onChange={(event) => setProject((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, soul: event.target.value } : item) }))} className="field mt-2 min-h-20 w-full rounded-xl px-3 py-2 text-sm font-medium normal-case outline-none" />
                  </label>
                  <label className="mt-3 block text-xs font-semibold tracking-widest text-cinnabar uppercase" htmlFor={`look-${character.id}`}>
                    Locked look
                    <textarea id={`look-${character.id}`} value={character.look} onChange={(event) => patchCast(character.id, { look: event.target.value, vessel: event.target.value }, false)} className="field mt-2 min-h-20 w-full rounded-xl px-3 py-2 text-sm font-medium normal-case outline-none" />
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(
                      [
                        ["face", "Face"],
                        ["hair", "Hair"],
                        ["age", "Age"],
                        ["scars", "Scars"],
                        ["eyes", "Eyes"],
                        ["body", "Body"],
                        ["outfit", "Outfit"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="block text-xs font-semibold tracking-widest text-cinnabar uppercase" htmlFor={`${key}-${character.id}`}>
                        {label}
                        <input
                          id={`${key}-${character.id}`}
                          value={character[key] || ""}
                          onChange={(event) => patchCast(character.id, { [key]: event.target.value }, true)}
                          className="field mt-2 min-h-11 w-full rounded-xl px-3 text-sm font-medium normal-case outline-none"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 block text-xs font-semibold tracking-widest text-cinnabar uppercase" htmlFor={`outfits-${character.id}`}>
                    Outfit changes, one chapter per line
                    <textarea
                      id={`outfits-${character.id}`}
                      value={outfitsToText(character.outfits)}
                      onChange={(event) => patchCast(character.id, { outfits: textToOutfits(event.target.value) }, true)}
                      placeholder={"420: black court robe\n460: travel cloak"}
                      className="field mt-2 min-h-20 w-full rounded-xl px-3 py-2 text-sm font-medium normal-case outline-none"
                    />
                  </label>
                  {character.faceUrl ? <img src={character.faceUrl} alt="" className="mt-3 h-24 w-16 rounded-lg object-cover" /> : <p className="mt-2 text-xs text-muted">The first accepted panel of this face is kept as a reference. A language switch does not replace it.</p>}
                </li>
              ))}
            </ul>
            <label className="block text-sm text-paper" htmlFor="bible-lock">
              Character bible
              <textarea id="bible-lock" value={project.bible || bible} onChange={(event) => { setBible(event.target.value); setProject((current) => ({ ...current, bible: event.target.value })); }} className="field mt-2 min-h-28 w-full rounded-xl px-3 py-3 text-sm outline-none" placeholder="Face, hair, scars, outfit, and the chapter an outfit changes. Written once. A language switch does not rebuild it." />
            </label>
            <button type="button" onClick={() => void writeMissingPrompts(project)} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
              Write prompts, one beat at a time
            </button>
            <button type="button" onClick={() => void onPaint()} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Paint unpainted panels
            </button>
            <p className="text-xs text-muted">One English prompt per beat, then one picture. The worker checkpoint draws it. If that model cannot load, the free fallback is used and faces can drift. A language switch does not come back here.</p>
          </section>
        ) : null}

        {!showSettings && tab === "strip" ? (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-3xl text-paper">Explanation film</h2>
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Aspect ratio">
              {(["16:9", "9:16"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={aspect === option} onClick={() => setAspect(option)} className={`min-h-12 rounded-xl text-sm font-semibold ${aspect === option ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  {option === "16:9" ? "16:9 YouTube" : "9:16 Shorts"}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">
              {project.scenes.length} panels. Play scrubs the pictures already made. A language switch does not send them back to the painter.
            </p>
            <div className="overflow-hidden rounded-2xl bg-ink">
              {project.scenes[playAt]?.imageUrl ? (
                <img src={project.scenes[playAt]?.imageUrl || ""} alt="" className={aspect === "16:9" ? "aspect-video w-full object-cover" : "aspect-[9/16] max-h-[70vh] w-full object-cover"} />
              ) : (
                <div className="flex aspect-[9/16] items-end justify-center pb-4">
                  <p className="text-xs font-semibold tracking-widest text-muted uppercase">Not painted</p>
                </div>
              )}
              <div className="bg-paper px-4 py-3 text-ink">
                <p className="text-xs font-semibold tracking-widest text-seal uppercase">{language === "hi" ? "Hindi caption" : "English caption"}</p>
                <p className="mt-1 font-display text-lg leading-snug">{project.scenes[playAt] ? voiceLine(project.scenes[playAt], language) : ""}</p>
              </div>
            </div>
            <label className="block text-sm text-paper" htmlFor="panel-seek">
              Panel {playAt + 1} of {Math.max(project.scenes.length, 1)}
              <input
                id="panel-seek"
                type="range"
                min={0}
                max={Math.max(project.scenes.length - 1, 0)}
                value={Math.min(playAt, Math.max(project.scenes.length - 1, 0))}
                onChange={(event) => setPlayAt(Number(event.target.value))}
                className="mt-2 w-full"
              />
            </label>
            <button type="button" onClick={() => void onPlayPanels()} disabled={!!busy || project.scenes.length === 0} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Play from this panel
            </button>
            {project.bible ? <p className="text-xs text-muted">Look lock: {project.bible.slice(0, 220)}</p> : null}
            <div className="space-y-4">
              {project.scenes.map((scene, index) => {
                const other = language === "hi" ? "en" : "hi";
                const otherLine = voiceLine(scene, other);
                return (
                  <div key={scene.id} className="space-y-2">
                    <PanelArt scene={scene} wide={aspect === "16:9"} />
                    <p className="text-xs text-muted">
                      Beat {index + 1}
                      {scene.locked ? " · source panel, not redrawn" : ""}
                      {" · "}
                      EN voice {voiced[`${scene.id}:en`] ? "saved" : "missing"}
                      {" · "}
                      HI voice {voiced[`${scene.id}:hi`] ? "saved" : "missing"}
                      {scene.checkNote ? ` · ${scene.checkNote}` : ""}
                    </p>
                    <label className="block text-sm text-paper" htmlFor={`line-${scene.id}`}>
                      {language === "hi" ? "Hindi line" : "English line"}
                      <textarea id={`line-${scene.id}`} value={[scene.caption, scene.dialogue].filter(Boolean).join("\n")} onChange={(event) => patchScene(scene.id, { caption: event.target.value, dialogue: "" })} className="field mt-2 min-h-20 w-full rounded-xl px-3 py-2 text-sm outline-none" />
                    </label>
                    {otherLine ? <p className="text-xs text-muted">{other === "hi" ? "Hindi" : "English"} kept: {otherLine}</p> : <p className="text-xs text-muted">{other === "hi" ? "Hindi" : "English"} line is not written yet. A language switch translates this beat only.</p>}
                    {scene.locked ? null : (
                      <label className="block text-sm text-paper" htmlFor={`prompt-${scene.id}`}>
                        Image prompt, English
                        <textarea id={`prompt-${scene.id}`} value={scene.imagePrompt} onChange={(event) => setProject((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, imagePrompt: event.target.value, promptLocked: event.target.value.trim().length > 0 } : item) }))} className="field mt-2 min-h-24 w-full rounded-xl px-3 py-2 text-sm outline-none" />
                      </label>
                    )}
                    {scene.locked ? null : (
                      <button type="button" onClick={() => void onPaint(scene.id)} disabled={!!busy} className="min-h-11 rounded-xl bg-panel px-4 text-sm font-semibold text-paper disabled:opacity-50">
                        Retry this panel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => void onSendJob()} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Render explanation video
            </button>
          </section>
        ) : null}

        {!showSettings && tab === "chat" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Chat</h2>
              <p className="mt-2 text-sm text-muted">Same AI as the director. It can see this project. Correct a look or a line here. A language change does not redraw.</p>
            </div>
            <ul className="space-y-2">
              {chatLog.map((entry, index) => (
                <li key={`${entry.role}-${index}`} className={`rounded-2xl px-4 py-3 text-sm ${entry.role === "user" ? "bg-seal text-paper" : "bg-ink-2 text-paper"}`}>
                  {entry.text}
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void onChat();
              }}
            >
              <label className="min-w-0 flex-1" htmlFor="chat-draft">
                <span className="sr-only">Message</span>
                <input id="chat-draft" value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="The scar is on the left cheek" className="field min-h-12 w-full rounded-xl px-3 text-base outline-none" />
              </label>
              <button type="submit" disabled={!!busy || !chatDraft.trim()} className="min-h-12 rounded-xl bg-seal px-4 text-sm font-semibold text-paper disabled:opacity-50">
                Send
              </button>
            </form>
            {chatLog.some((entry) => entry.role === "studio") ? (
              <button
                type="button"
                onClick={() => {
                  const last = [...chatLog].reverse().find((entry) => entry.role === "studio");
                  if (!last) return;
                  setBible((current) => [current, last.text].filter(Boolean).join("\n"));
                  setProject((current) => ({ ...current, bible: [current.bible, last.text].filter(Boolean).join("\n") }));
                  setNotice("Saved into the character bible. Pictures were not redrawn.");
                }}
                className="min-h-11 text-sm font-semibold text-cinnabar"
              >
                Lock the last reply into the character bible
              </button>
            ) : null}
          </section>
        ) : null}

        {!showSettings && tab === "bay" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Factory bay</h2>
              <p className="mt-2 text-sm text-muted">
                {workerUrl.trim()
                  ? "The worker keeps the long file. Scrub the master here. Language change = audio, captions, and SEO only. Pictures stay."
                  : "The worker is offline. Scrub the panels on Beats. This phone will not pretend a full film is ready."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={language === "en"} onClick={() => void onPickLanguage("en")} className={`min-h-12 rounded-xl text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                English audio
              </button>
              <button type="button" aria-pressed={language === "hi"} onClick={() => void onPickLanguage("hi")} className={`min-h-12 rounded-xl text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                Hindi audio
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl bg-ink">
              {filmSrc ? (
                <video
                  key={filmSrc}
                  src={filmSrc}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-[9/16] max-h-[70vh] w-full bg-ink"
                  onLoadedData={() => {
                    setPreviewSeen(true);
                    setPreviewBroken(false);
                  }}
                  onError={() => setPreviewBroken(true)}
                />
              ) : (
                <div className="flex aspect-[9/16] max-h-80 items-end justify-center pb-4">
                  <p className="px-4 text-center text-xs font-semibold tracking-widest text-muted uppercase">Worker offline</p>
                </div>
              )}
            </div>
            {previewBroken ? <p className="text-sm text-paper">The worker is offline, or the {language === "hi" ? "Hindi" : "English"} master is not ready. Pictures were not redrawn.</p> : null}
            <div className="rounded-2xl bg-ink-2 p-4">
              <div className="flex items-center gap-2">
                <Mic className="size-4 text-cinnabar" aria-hidden />
                <h3 className="text-lg text-paper">Narration · {voice}</h3>
              </div>
              <p className="mt-2 text-sm text-paper">{project.narration}</p>
              <button type="button" onClick={onSpeak} disabled={!!busy} className="mt-3 min-h-12 w-full rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
                Read it
              </button>
              <button type="button" onClick={() => void fillVoices(project, language, true)} disabled={!!busy} className="mt-2 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                Re-voice missing lines
              </button>
            </div>
            <div className="rounded-2xl bg-ink-2 p-4">
              <h3 className="text-lg text-paper">{language === "hi" ? "Hindi captions" : "English captions"}</h3>
              <pre className="mt-2 max-h-40 overflow-auto text-xs text-paper">{srtFor(project, language)}</pre>
              <button type="button" onClick={() => onCopy(srtFor(project, language), language === "hi" ? "Hindi captions" : "English captions")} className="mt-2 min-h-11 text-sm font-semibold text-cinnabar">
                Copy this .srt
              </button>
              <p className="mt-2 text-xs text-muted">The other language keeps its own captions. Silence is trimmed on the worker after each voice, without cutting a breath inside a line.</p>
            </div>
            <button type="button" onClick={() => void onSendJob()} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Send film to worker
            </button>
            <div className="rounded-2xl bg-ink-2 p-4">
              <h3 className="text-lg text-paper">Render status</h3>
              {job ? (
                <div className="mt-3" aria-live="polite">
                  <p className="text-sm text-paper">
                    {job.id} · {job.status}
                    {job.label ? ` · ${job.label}` : ""}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-cinnabar" style={{ width: `${job.progress}%` }} />
                  </div>
                  {job.error ? <p className="mt-2 text-sm text-paper">{job.error}</p> : null}
                  <button type="button" onClick={() => void onSendJob()} disabled={!!busy} className="mt-3 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                    Render again
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">No job yet. Connect the worker, then render.</p>
              )}
            </div>
            <button type="button" onClick={() => setShowCell((value) => !value)} className="min-h-11 text-sm font-semibold text-cinnabar">
              {showCell ? "Hide factory cell" : "Show factory cell"}
            </button>
            {showCell ? (
              <div>
                <pre className="max-h-80 overflow-auto rounded-2xl bg-ink-2 p-3 text-xs text-paper">{FACTORY_CELL}</pre>
                <button type="button" onClick={() => onCopy(FACTORY_CELL, "Factory cell")} className="mt-2 min-h-11 rounded-xl bg-panel px-4 text-sm text-paper">
                  Copy factory cell
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {!showSettings && tab === "youtube" ? (
          <section className="space-y-4" aria-labelledby="youtube-heading">
            <div>
              <h2 id="youtube-heading" className="text-3xl text-paper">
                YouTube
              </h2>
              <p className="mt-2 text-sm text-muted">Preview first. Upload uses the {language === "hi" ? "Hindi" : "English"} channel and that language’s master. The phone does not hold the full file. Nothing uploads until you press Upload.</p>
            </div>
            <div className="overflow-hidden rounded-2xl bg-ink">
              {filmSrc ? (
                <video
                  key={`yt-${filmSrc}`}
                  src={filmSrc}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-[9/16] max-h-[70vh] w-full bg-ink"
                  onLoadedData={() => {
                    setPreviewSeen(true);
                    setPreviewBroken(false);
                  }}
                  onError={() => setPreviewBroken(true)}
                />
              ) : previewUrl ? (
                <video src={previewUrl} controls playsInline className="aspect-video w-full bg-ink" onLoadedData={() => setPreviewSeen(true)} />
              ) : (
                <div className="flex aspect-[9/16] max-h-80 items-end justify-center pb-4">
                  <p className="text-xs font-semibold tracking-widest text-muted uppercase">No preview yet</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={language === "en"} onClick={() => void onPickLanguage("en")} className={`min-h-12 rounded-xl text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                English master
              </button>
              <button type="button" aria-pressed={language === "hi"} onClick={() => void onPickLanguage("hi")} className={`min-h-12 rounded-xl text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                Hindi master
              </button>
            </div>
            <button type="button" onClick={onPreview} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
              Load a short preview if the worker stream will not play
            </button>
            <label className="block" htmlFor="yt-client">
              <span className="text-sm font-medium text-paper">Google OAuth client id</span>
              <input id="yt-client" value={ytClientId} onChange={(event) => setYtClientId(event.target.value)} autoComplete="off" spellCheck={false} placeholder="….apps.googleusercontent.com" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p className={`rounded-xl px-3 py-3 ${channels.en.token ? "badge-ok" : "bg-panel text-paper"}`}>English channel {channels.en.channel || channels.en.email || (channels.en.token ? "connected" : "not connected")}</p>
              <p className={`rounded-xl px-3 py-3 ${channels.hi.token ? "badge-ok" : "bg-panel text-paper"}`}>Hindi channel {channels.hi.channel || channels.hi.email || (channels.hi.token ? "connected" : "not connected")}</p>
            </div>
            <button type="button" onClick={onConnectYoutube} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              {language === "hi" ? "Connect Hindi channel" : "Connect English channel"}
            </button>
            {channels[language].token || ytToken ? (
              <p className="badge-ok rounded-xl px-3 py-2 text-sm font-semibold">
                {(language === "hi" ? channels.hi.email : channels.en.email) || ytEmail || "Account connected"}
                {(language === "hi" ? channels.hi.channel : channels.en.channel) || ytChannel ? ` · ${(language === "hi" ? channels.hi.channel : channels.en.channel) || ytChannel}` : ""}
              </p>
            ) : null}
            <label className="block" htmlFor="yt-title">
              <span className="text-sm font-medium text-paper">Title</span>
              <input id="yt-title" value={project.seo.title} maxLength={100} onChange={(event) => setProject((current) => ({ ...current, seo: { ...current.seo, title: event.target.value } }))} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <label className="block" htmlFor="yt-description">
              <span className="text-sm font-medium text-paper">Description</span>
              <textarea id="yt-description" value={project.seo.description} maxLength={5000} onChange={(event) => setProject((current) => ({ ...current, seo: { ...current.seo, description: event.target.value } }))} className="field mt-2 min-h-32 w-full rounded-xl px-3 py-3 text-base outline-none" />
            </label>
            <label className="block" htmlFor="yt-tags">
              <span className="text-sm font-medium text-paper">Tags</span>
              <input id="yt-tags" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onBlur={() => setProject((current) => ({ ...current, seo: { ...current.seo, tags: parseTags(tagDraft) } }))} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <label className="block" htmlFor="yt-hash">
              <span className="text-sm font-medium text-paper">Hashtags</span>
              <input id="yt-hash" value={project.seo.hashtags || ""} onChange={(event) => setProject((current) => ({ ...current, seo: { ...current.seo, hashtags: event.target.value } }))} className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["private", "unlisted", "public"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={youtubePrivacy(project.seo.privacy) === option} onClick={() => setProject((current) => ({ ...current, seo: { ...current.seo, privacy: option } }))} className={`min-h-11 rounded-xl px-2 text-sm font-semibold capitalize ${youtubePrivacy(project.seo.privacy) === option ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  {option}
                </button>
              ))}
            </div>
            <button type="button" onClick={onUpload} disabled={!!busy || !(channels[language].token || ytToken) || (!previewSeen && !previewUrl)} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Upload to the {language === "hi" ? "Hindi" : "English"} channel
            </button>
            {watchUrl ? (
              <a href={watchUrl} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-cinnabar">
                {watchUrl}
              </a>
            ) : null}
          </section>
        ) : null}
      </div>

      {!showSettings && tab !== "chat" ? (
        <button
          type="button"
          onClick={() => {
            setShowSettings(false);
            setTab("chat");
          }}
          className="fixed right-4 bottom-20 z-30 flex min-h-12 items-center gap-2 rounded-full bg-seal px-4 text-sm font-semibold text-paper"
        >
          <MessageCircle className="size-4" aria-hidden />
          Chat
        </button>
      ) : null}

      <nav className="dock-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur" aria-label="Studio">
        <div className="mx-auto grid max-w-lg grid-cols-6">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setShowSettings(false);
                  setTab(item.id);
                }}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] leading-none whitespace-nowrap ${active ? "text-cinnabar" : "text-muted"}`}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

function BenchLinks({
  colabUrl,
  kaggleUrl,
  onColab,
  onKaggle,
  onTest,
  busy,
  badge,
}: {
  colabUrl: string;
  kaggleUrl: string;
  onColab: (value: string) => void;
  onKaggle: (value: string) => void;
  onTest: (value: string) => void;
  busy: boolean;
  badge: string | null;
}) {
  const colab = safeHttp(colabUrl);
  const kaggle = safeHttp(kaggleUrl);
  return (
    <div className="space-y-3 rounded-2xl bg-ink-2 p-4">
      <h3 className="text-lg text-paper">Colab and Kaggle</h3>
      <p className="text-xs text-muted">Notebook links are not saved. Test hits the live worker health check.</p>
      <label className="block" htmlFor="colab-url">
        <span className="text-sm font-medium text-paper">Colab URL</span>
        <input id="colab-url" value={colabUrl} onChange={(event) => onColab(event.target.value)} placeholder="https://colab.research.google.com/…" inputMode="url" autoComplete="off" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <a href={colab ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!colab} className={`flex min-h-11 items-center justify-center rounded-xl bg-panel text-sm font-semibold text-paper ${colab ? "" : "pointer-events-none opacity-50"}`}>
          Open Colab
        </a>
        <button type="button" onClick={() => onTest(colabUrl)} disabled={busy} className="min-h-11 rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
          Test & Connect
        </button>
      </div>
      <label className="block" htmlFor="kaggle-url">
        <span className="text-sm font-medium text-paper">Kaggle URL</span>
        <input id="kaggle-url" value={kaggleUrl} onChange={(event) => onKaggle(event.target.value)} placeholder="https://www.kaggle.com/code/…" inputMode="url" autoComplete="off" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <a href={kaggle ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!kaggle} className={`flex min-h-11 items-center justify-center rounded-xl bg-panel text-sm font-semibold text-paper ${kaggle ? "" : "pointer-events-none opacity-50"}`}>
          Open Kaggle
        </a>
        <button type="button" onClick={() => onTest(kaggleUrl)} disabled={busy} className="min-h-11 rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
          Test & Connect
        </button>
      </div>
      {badge ? <p className="badge-ok rounded-xl px-3 py-2 text-sm font-semibold">{badge}</p> : null}
    </div>
  );
}
