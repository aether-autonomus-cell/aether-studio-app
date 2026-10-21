import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Factory, Mic, ScrollText, Settings, Sparkles, Youtube } from "lucide-react";
import {
  directChapter,
  fetchSource,
  jobStatus,
  paintPanel,
  speakLine,
  submitJob,
  testWorker,
  uploadYoutube,
  verifyCloud,
} from "@/lib/studio/api";
import {
  EXPLAIN_VOICES,
  LOCAL_MODES,
  PROVIDER_PRESETS,
  defaultModel,
  type CloudProvider,
  type LocalMode,
} from "@/lib/studio/ai-router";
import { chooseVoice, downloadBlob, loadVoices, primeSpeechUnlock, speakOnDevice } from "@/lib/studio/export";
import { sanitizeNovelText } from "@/lib/studio/extract";
import type { JobSnapshot } from "@/lib/studio/jobs";
import {
  FACTORY_CELL,
  SAMPLE,
  SAMPLE_TEXT,
  dialogueWithoutSpeaker,
  jobPacket,
  mergeCuts,
  projectFromChapters,
  projectWithAbsoluteArt,
  youtubePrivacy,
  type Project,
  type Scene,
} from "@/lib/studio/model";
import { chunkChapterText, expandChapterUrls } from "@/lib/studio/range";
import { containsHan } from "@/lib/studio/wtr";

type Tab = "story" | "forge" | "strip" | "bay" | "youtube";
type Aspect = "16:9" | "9:16";

const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as CloudProvider[];

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
  const [language, setLanguage] = useState<"hi" | "en">("en");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [colabUrl, setColabUrl] = useState("");
  const [kaggleUrl, setKaggleUrl] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [ytClientId, setYtClientId] = useState("");
  const [ytToken, setYtToken] = useState("");
  const [ytEmail, setYtEmail] = useState("");
  const [ytChannel, setYtChannel] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState(SAMPLE.seo.tags.join(", "));
  const seenTags = useRef(SAMPLE.seo.tags.join("|"));

  useEffect(() => {
    wipeLegacySecrets();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const preset = PROVIDER_PRESETS[provider];
  const voice = EXPLAIN_VOICES[language];

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
    };
  }

  function applyLanguage(next: "hi" | "en") {
    setLanguage(next);
    setProject((current) => ({ ...current, language: next, voice: EXPLAIN_VOICES[next] }));
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

  async function directText(cleaned: string): Promise<boolean> {
    const chunks = chunkChapterText(cleaned);
    if (!chunks.length) {
      setError("Paste at least a short chapter.");
      return false;
    }
    const parts: Project[] = [];
    const call = session();
    for (let index = 0; index < chunks.length; index += 1) {
      setBusy(chunks.length > 1 ? `Directing part ${index + 1} of ${chunks.length}` : "Directing the manhua explanation");
      const result = await directChapter({ data: { text: chunks[index], ...call } });
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
    const merged = keepPrivacy(mergeCuts(parts), project);
    setProject(stamp(merged, parts.find((part) => part.hook)?.hook));
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
      const fetched: { index: number; title: string; sourceUrl: string; text: string }[] = [];
      try {
        for (let index = 0; index < urls.length; index += 1) {
          const chapter = start + index;
          setBusy(`Reading chapter ${chapter} (${index + 1} of ${urls.length})`);
          const result = await fetchSource({ data: { url: urls[index] } });
          if (!result.ok) {
            setError(`Chapter ${chapter}: ${result.error}`);
            return;
          }
          fetched.push({
            index: chapter,
            title: sanitizeNovelText(result.title) || `Chapter ${chapter}`,
            sourceUrl: urls[index],
            text: sanitizeNovelText(result.text),
          });
        }
        const combined = fetched.map((chapter) => `${chapter.title}\n\n${chapter.text}`).join("\n\n");
        if (containsHan(combined)) {
          setDraft(combined);
          setNotice("Chinese text pulled. Translating into the explanation script.");
          await directText(combined);
          return;
        }
        const next = keepPrivacy(projectFromChapters(fetched), project);
        setProject({ ...next, language, voice, aspect, localModel });
        setDraft(next.text);
        setNotice(`${fetched.length} chapters fetched. Run the director to write the explanation.`);
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
      const result = await fetchSource({ data: { url } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const text = sanitizeNovelText(result.title ? `${result.title}\n\n${result.text}` : result.text);
      setDraft(text);
      if (containsHan(text)) {
        setNotice("Chinese chapter pulled. Translating it into the explanation.");
        await directText(text);
        return;
      }
      setNotice("Page text is in the script. Direct it when you want the explanation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The page did not load.");
    } finally {
      setBusy(null);
    }
  }

  async function onPaint() {
    const targets = project.scenes.filter((scene) => !scene.imageUrl);
    if (!targets.length) {
      setNotice("The open panels are already painted.");
      return;
    }
    setError(null);
    const call = session();
    for (let index = 0; index < targets.length; index += 1) {
      const scene = targets[index];
      setBusy(`Painting panel ${index + 1} of ${targets.length}`);
      try {
        const result = await paintPanel({ data: { prompt: scene.imagePrompt, ...call } });
        if (!result.ok) {
          setError(result.error);
          break;
        }
        setProject((current) => ({
          ...current,
          scenes: current.scenes.map((item) => (item.id === scene.id ? { ...item, imageUrl: result.url } : item)),
          chapters: current.chapters?.map((chapter) => ({
            ...chapter,
            scenes: chapter.scenes.map((item) =>
              `c${chapter.index}-${item.id}` === scene.id || item.id === scene.id ? { ...item, imageUrl: result.url } : item,
            ),
          })),
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Painting stopped.");
        break;
      }
    }
    setBusy(null);
    setTab("strip");
  }

  useEffect(() => {
    setTrack(null);
  }, [project.narration]);

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

  function packetNow() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return jobPacket(projectWithAbsoluteArt({ ...project, language, voice, aspect, localModel, hook: project.hook }, origin));
  }

  async function onSendJob() {
    setBusy("Rendering the explanation video");
    setError(null);
    setWatchUrl(null);
    try {
      const result = await submitJob({ data: { url: workerUrl, token: workerToken, packet: packetNow() } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.jobId) {
        setJob({ id: result.jobId, status: "queued", progress: 0, label: "Accepted", error: "", mp4Url: null });
        setNotice(`Worker accepted the film. Watching job ${result.jobId}.`);
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
        setJob(result.job);
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

  async function onDownloadMp4() {
    if (!job) return;
    setBusy("Fetching the full MP4");
    setError(null);
    try {
      const res = await fetch("/api/studio/mp4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: workerUrl, token: workerToken, jobId: job.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "The MP4 did not download.");
        return;
      }
      const blob = await res.blob();
      const slug = project.title.replace(/[^\w]+/g, "-").toLowerCase() || "aether";
      downloadBlob(blob, `${slug}.mp4`);
      setNotice("Full MP4 saved. The YouTube upload does not need this file.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The MP4 did not download.");
    } finally {
      setBusy(null);
    }
  }

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
              setNotice("YouTube channel connected for this tab only.");
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
    if (!job || (job.status !== "done" && !job.mp4Url)) {
      setError("Render the video and watch the 6 second preview before uploading.");
      return;
    }
    if (!previewUrl) {
      setError("Play the 6 second preview first. The full film stays on the worker until you approve it.");
      return;
    }
    if (!ytToken) {
      setError("Connect a YouTube channel first.");
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
          accessToken: ytToken,
          title: project.seo.title,
          description: project.seo.description,
          tags,
          privacy: youtubePrivacy(project.seo.privacy),
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

  const tabs: { id: Tab; label: string; icon: typeof ScrollText }[] = [
    { id: "story", label: "Script", icon: ScrollText },
    { id: "forge", label: "Cast", icon: Sparkles },
    { id: "strip", label: "Film", icon: Clapperboard },
    { id: "bay", label: "Bay", icon: Factory },
    { id: "youtube", label: "YouTube", icon: Youtube },
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
                <button type="button" aria-pressed={language === "hi"} onClick={() => applyLanguage("hi")} className={`min-h-12 rounded-xl px-3 text-left text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Hindi (Desi manhua explanation) · hi-IN-MadhurNeural
                </button>
                <button type="button" aria-pressed={language === "en"} onClick={() => applyLanguage("en")} className={`min-h-12 rounded-xl px-3 text-left text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  English (dramatic recap) · en-US-ChristopherNeural
                </button>
              </div>
            </fieldset>
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
                <button type="button" aria-pressed={language === "hi"} onClick={() => applyLanguage("hi")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${language === "hi" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  Hindi
                </button>
                <button type="button" aria-pressed={language === "en"} onClick={() => applyLanguage("en")} className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${language === "en" ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  English
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
              <button type="button" onClick={onFetch} disabled={!!busy || !url.trim()} className="mt-3 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                {rangeStart.trim() || rangeEnd.trim() ? "Pull chapter range" : "Pull readable text"}
              </button>
            </div>
          </section>
        ) : null}

        {!showSettings && tab === "forge" ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-3xl text-paper">Soul and vessel</h2>
              <p className="mt-2 text-sm text-muted">{project.hook || project.logline}</p>
            </div>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {project.characters.length === 0 ? <li className="text-sm text-muted">No named cast in this cut.</li> : null}
              {project.characters.map((character) => (
                <li key={character.id} className="w-64 shrink-0 rounded-2xl bg-ink-2 p-4">
                  <p className="font-display text-2xl text-paper">{character.name}</p>
                  <p className="mt-3 text-xs font-semibold tracking-widest text-cinnabar uppercase">Soul</p>
                  <p className="mt-1 text-sm text-paper">{character.soul}</p>
                  <p className="mt-3 text-xs font-semibold tracking-widest text-cinnabar uppercase">Vessel</p>
                  <p className="mt-1 text-sm text-muted">{character.vessel}</p>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onPaint} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Paint unpainted panels
            </button>
            <p className="text-xs text-muted">Unlimited panels. Gemini paints when that key is verified. Otherwise the connected worker draws the frame the video will move.</p>
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
              {project.scenes.length} panels. The worker renders Ken Burns, glowing phrase subtitles, {voice}, and ducked music. This phone does not stack a PNG strip.
            </p>
            <div className="space-y-4">
              {project.scenes.map((scene) => (
                <PanelArt key={scene.id} scene={scene} wide={aspect === "16:9"} />
              ))}
            </div>
            <button type="button" onClick={onSendJob} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Render explanation video
            </button>
          </section>
        ) : null}

        {!showSettings && tab === "bay" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Factory bay</h2>
              <p className="mt-2 text-sm text-muted">
                Paste the cell on a Colab T4 or a Kaggle T4x2. Notebook links and the worker test live in Settings, in this tab’s memory only.
              </p>
            </div>
            <div className="rounded-2xl bg-ink-2 p-4">
              <div className="flex items-center gap-2">
                <Mic className="size-4 text-cinnabar" aria-hidden />
                <h3 className="text-lg text-paper">Narration · {voice}</h3>
              </div>
              <p className="mt-2 text-sm text-paper">{project.narration}</p>
              <button type="button" onClick={onSpeak} disabled={!!busy} className="mt-3 min-h-12 w-full rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
                Read it
              </button>
            </div>
            <button type="button" onClick={onSendJob} disabled={!!busy || !workerUrl.trim()} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
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
                  <button type="button" onClick={onSendJob} disabled={!!busy} className="mt-3 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
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
              <p className="mt-2 text-sm text-muted">Watch six seconds, then the worker uploads the full film. The Google token is not saved.</p>
            </div>
            <div className="overflow-hidden rounded-2xl bg-ink">
              {previewUrl ? (
                <video src={previewUrl} controls playsInline className="aspect-video w-full bg-ink" />
              ) : (
                <div className="flex aspect-video items-end justify-center pb-4">
                  <p className="text-xs font-semibold tracking-widest text-muted uppercase">No preview yet</p>
                </div>
              )}
            </div>
            <button type="button" onClick={onPreview} disabled={!!busy || !workerUrl.trim() || !job || (job.status !== "done" && !job.mp4Url)} className="min-h-12 w-full rounded-2xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
              Play 6-second preview
            </button>
            <label className="block" htmlFor="yt-client">
              <span className="text-sm font-medium text-paper">Google OAuth client id</span>
              <input id="yt-client" value={ytClientId} onChange={(event) => setYtClientId(event.target.value)} autoComplete="off" spellCheck={false} placeholder="….apps.googleusercontent.com" className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none" />
            </label>
            <button type="button" onClick={onConnectYoutube} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Select Google Account / Connect YouTube Channel
            </button>
            {ytToken ? (
              <p className="badge-ok rounded-xl px-3 py-2 text-sm font-semibold">
                {ytEmail || "Account connected"}
                {ytChannel ? ` · ${ytChannel}` : ""}
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
            <div className="grid grid-cols-3 gap-2">
              {(["public", "unlisted", "private"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={youtubePrivacy(project.seo.privacy) === option} onClick={() => setProject((current) => ({ ...current, seo: { ...current.seo, privacy: option } }))} className={`min-h-11 rounded-xl px-2 text-sm font-semibold capitalize ${youtubePrivacy(project.seo.privacy) === option ? "bg-seal text-paper" : "bg-panel text-paper"}`}>
                  {option}
                </button>
              ))}
            </div>
            <button type="button" onClick={onUpload} disabled={!!busy || !ytToken || !previewUrl} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              OK — Upload Directly to YouTube
            </button>
            {watchUrl ? (
              <a href={watchUrl} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-cinnabar">
                {watchUrl}
              </a>
            ) : null}
            <button type="button" onClick={onDownloadMp4} disabled={!!busy || !job || (job.status !== "done" && !job.mp4Url)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
              <Download className="size-4" aria-hidden />
              Download Full MP4 to Phone
            </button>
          </section>
        ) : null}
      </div>

      <nav className="dock-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur" aria-label="Studio">
        <div className="mx-auto grid max-w-lg grid-cols-5">
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
