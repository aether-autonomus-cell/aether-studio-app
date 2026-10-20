import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Factory, Mic, ScrollText, Settings, Sparkles, Youtube } from "lucide-react";
import { InstallHint } from "@/components/studio/install-hint";
import { directChapter, fetchSource, jobStatus, paintPanel, speakLine, submitJob, testWorker } from "@/lib/studio/api";
import type { AiProvider } from "@/lib/studio/config";
import { chooseVoice, downloadBlob, loadVoices, primeSpeechUnlock, renderStripPng, speakOnDevice } from "@/lib/studio/export";
import { sanitizeNovelText } from "@/lib/studio/extract";
import type { JobSnapshot } from "@/lib/studio/jobs";
import { FACTORY_CELL, SAMPLE, SAMPLE_TEXT, cutChapter, dialogueWithoutSpeaker, jobPacket, mergeCuts, projectFromChapters, youtubePrivacy, type Project, type Scene, type YoutubePrivacy } from "@/lib/studio/model";
import { chunkChapterText, expandChapterUrls } from "@/lib/studio/range";

type Tab = "story" | "forge" | "strip" | "bay" | "youtube";
type WorkerMode = "live" | "packet";

const STORAGE_KEY = "aether-studio-v1";
const SESSION_KEY = "aether-worker-session";
const GEMINI_KEY_STORAGE = "aether-gemini-key";
const BENCH_KEY = "aether-bench-urls";

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
  if (source === "grok") return "Directed";
  return "Phone cut";
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

const PRIVACY_COPY: Record<YoutubePrivacy, string> = {
  public: "Anyone could watch it, once you upload it yourself.",
  unlisted: "Only people with the link, once you upload it yourself.",
  private: "Only you, once you upload it yourself.",
};

function PanelArt({ scene, wide }: { scene: Scene; wide: boolean }) {
  const line = dialogueWithoutSpeaker(scene);
  const art = scene.imageUrl ? (
    <img
      src={scene.imageUrl}
      alt={scene.caption || line || "Panel"}
      className={wide ? "h-full w-full object-cover" : "aspect-[2/3] w-full object-cover"}
    />
  ) : (
    <div className={`flex items-end justify-center bg-panel pb-4 ${wide ? "h-full w-full" : "aspect-[2/3] w-full"}`}>
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Not painted</p>
    </div>
  );
  const hit = scene.sfx ? (
    <p className={`sfx-hit pointer-events-none absolute top-3 left-3 z-10 font-display text-cinnabar italic ${wide ? "text-3xl" : "text-5xl"}`}>
      {scene.sfx}
    </p>
  ) : null;

  return (
    <figure className="rounded-2xl bg-ink-2 hairline">
      <div className={`relative overflow-hidden rounded-t-2xl bg-ink ${wide ? "aspect-video" : ""}`}>
        {wide && scene.imageUrl ? (
          <img src={scene.imageUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl" />
        ) : null}
        {wide ? (
          <div className="absolute inset-y-0 left-1/2 w-2/5 -translate-x-1/2 overflow-hidden">
            {art}
            {hit}
          </div>
        ) : (
          <>
            {art}
            {hit}
          </>
        )}
      </div>
      {line ? (
        <div className="mx-3 mt-3 rounded-2xl bg-paper px-4 py-3 text-ink">
          {scene.speaker ? (
            <p className="mb-1.5 text-xs font-semibold tracking-widest text-seal uppercase">{scene.speaker}</p>
          ) : null}
          <p className="font-display text-lg leading-snug break-words text-ink">{line}</p>
        </div>
      ) : null}
      {scene.caption ? (
        <p className="px-4 pt-3 pb-4 text-sm leading-relaxed break-words text-paper">{scene.caption}</p>
      ) : (
        <div className="h-3" />
      )}
    </figure>
  );
}

function YoutubePreview({
  project,
  onChange,
  onCopyCard,
}: {
  project: Project;
  onChange: (seo: Partial<Project["seo"]>) => void;
  onCopyCard: (text: string) => void;
}) {
  const privacy = youtubePrivacy(project.seo.privacy);
  const thumb = project.scenes.find((scene) => scene.imageUrl)?.imageUrl ?? null;
  const tagsKey = project.seo.tags.join("|");
  const [tagDraft, setTagDraft] = useState(project.seo.tags.join(", "));
  const seenTags = useRef(tagsKey);
  useEffect(() => {
    if (seenTags.current === tagsKey) return;
    seenTags.current = tagsKey;
    setTagDraft(project.seo.tags.join(", "));
  }, [tagsKey, project.seo.tags]);

  function cardText(tags: string[]): string {
    const title = sanitizeNovelText(project.seo.title) || project.seo.title;
    const description = sanitizeNovelText(project.seo.description) || project.seo.description;
    return `${title}\n\n${description}\n\n${tags.join(", ")}\n\nPrivacy: ${privacy}`;
  }

  return (
    <section className="space-y-4" aria-labelledby="youtube-heading">
      <div>
        <h2 id="youtube-heading" className="text-3xl text-paper">
          YouTube card
        </h2>
        <p className="mt-2 text-sm text-muted">
          Preview only. Sign-in is not connected, so nothing is uploaded. Paste this onto your own channel when you are ready.
        </p>
      </div>
      <article className="overflow-hidden rounded-2xl bg-ink-2 hairline">
        <div className="relative aspect-video bg-ink">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-end justify-center pb-4">
              <p className="text-xs font-semibold tracking-widest text-muted uppercase">Not painted</p>
            </div>
          )}
          <p className="absolute top-3 left-3 rounded-full bg-ink/90 px-3 py-1 text-[10px] font-semibold tracking-widest text-cinnabar uppercase">
            Not uploaded
          </p>
        </div>
        <div className="space-y-4 p-4">
          <label className="block" htmlFor="yt-title">
            <span className="flex items-baseline justify-between gap-3 text-sm font-medium text-paper">
              Title
              <span className="text-xs font-normal text-muted">{project.seo.title.length}/100</span>
            </span>
            <input
              id="yt-title"
              value={project.seo.title}
              maxLength={100}
              onChange={(event) => onChange({ title: event.target.value })}
              className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none"
            />
          </label>
          <label className="block" htmlFor="yt-description">
            <span className="flex items-baseline justify-between gap-3 text-sm font-medium text-paper">
              Description
              <span className="text-xs font-normal text-muted">{project.seo.description.length}/5000</span>
            </span>
            <textarea
              id="yt-description"
              value={project.seo.description}
              maxLength={5000}
              onChange={(event) => onChange({ description: event.target.value })}
              className="field mt-2 min-h-32 w-full rounded-xl px-3 py-3 text-base outline-none"
            />
          </label>
          <label className="block" htmlFor="yt-tags">
            <span className="text-sm font-medium text-paper">Tags</span>
            <input
              id="yt-tags"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={() => {
                const tags = parseTags(tagDraft);
                seenTags.current = tags.join("|");
                onChange({ tags });
                setTagDraft(tags.join(", "));
              }}
              placeholder="motion comic, manhua"
              className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
            />
            <span className="mt-2 block text-xs text-muted">Comma-separated. Fifteen tags at most. Not a sign-in.</span>
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-paper">Privacy</legend>
            <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Privacy">
              {(["public", "unlisted", "private"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={privacy === option}
                  onClick={() => onChange({ privacy: option })}
                  className={`min-h-11 rounded-xl px-2 text-sm font-semibold capitalize ${privacy === option ? "bg-seal text-paper" : "bg-panel text-paper"}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{PRIVACY_COPY[privacy]}</p>
          </fieldset>
          <button
            type="button"
            onClick={() => {
              const tags = parseTags(tagDraft);
              seenTags.current = tags.join("|");
              onChange({ tags });
              setTagDraft(tags.join(", "));
              onCopyCard(cardText(tags));
            }}
            className="min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper"
          >
            Copy card
          </button>
        </div>
      </article>
    </section>
  );
}

function BenchLinks({
  colabUrl,
  kaggleUrl,
  onColab,
  onKaggle,
}: {
  colabUrl: string;
  kaggleUrl: string;
  onColab: (value: string) => void;
  onKaggle: (value: string) => void;
}) {
  const colab = safeHttp(colabUrl);
  const kaggle = safeHttp(kaggleUrl);
  return (
    <div className="space-y-3 rounded-2xl bg-ink-2 p-4">
      <h3 className="text-lg text-paper">Colab and Kaggle</h3>
      <p className="text-xs text-muted">Saved on this phone. Switch notebooks without retyping. The job packet is still what you upload.</p>
      <label className="block" htmlFor="colab-url">
        <span className="text-sm font-medium text-paper">Colab URL</span>
        <input
          id="colab-url"
          value={colabUrl}
          onChange={(event) => onColab(event.target.value)}
          placeholder="https://colab.research.google.com/drive/…"
          inputMode="url"
          autoComplete="off"
          className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
        />
      </label>
      <a
        href={colab ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!colab}
        className={`flex min-h-11 items-center justify-center rounded-xl bg-panel text-sm font-semibold text-paper ${colab ? "" : "pointer-events-none opacity-50"}`}
      >
        Open Colab
      </a>
      <label className="block" htmlFor="kaggle-url">
        <span className="text-sm font-medium text-paper">Kaggle URL</span>
        <input
          id="kaggle-url"
          value={kaggleUrl}
          onChange={(event) => onKaggle(event.target.value)}
          placeholder="https://www.kaggle.com/code/…"
          inputMode="url"
          autoComplete="off"
          className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
        />
      </label>
      <a
        href={kaggle ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!kaggle}
        className={`flex min-h-11 items-center justify-center rounded-xl bg-panel text-sm font-semibold text-paper ${kaggle ? "" : "pointer-events-none opacity-50"}`}
      >
        Open Kaggle
      </a>
    </div>
  );
}

export function StudioApp() {
  const [tab, setTab] = useState<Tab>("strip");
  const [project, setProject] = useState<Project>(SAMPLE);
  const [draft, setDraft] = useState(SAMPLE_TEXT);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [showCell, setShowCell] = useState(false);
  const [track, setTrack] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [workerMode, setWorkerMode] = useState<WorkerMode>("packet");
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerToken, setWorkerToken] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [geminiKey, setGeminiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [colabUrl, setColabUrl] = useState("");
  const [kaggleUrl, setKaggleUrl] = useState("");
  const [keysReady, setKeysReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [job, setJob] = useState<JobSnapshot | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { project?: Project; draft?: string };
      if (parsed.project?.scenes?.length && parsed.project.text) {
        setProject(parsed.project);
        setDraft(parsed.draft || parsed.project.text);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const slim: Project = {
        ...project,
        scenes: project.scenes.map((scene) => ({
          ...scene,
          imageUrl: scene.imageUrl && !scene.imageUrl.startsWith("/") ? null : scene.imageUrl,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ project: slim, draft }));
    } catch {
      /* private mode or a full store — the session still works */
    }
  }, [project, draft]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        mode?: string;
        workerUrl?: string;
        workerToken?: string;
        provider?: string;
        job?: JobSnapshot;
      };
      setWorkerMode(parsed.mode === "live" ? "live" : "packet");
      setWorkerUrl(typeof parsed.workerUrl === "string" ? parsed.workerUrl : "");
      setWorkerToken(typeof parsed.workerToken === "string" ? parsed.workerToken : "");
      setAiProvider(parsed.provider === "worker" ? "worker" : "gemini");
      if (parsed.job && typeof parsed.job.id === "string") setJob(parsed.job);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ mode: workerMode, workerUrl, workerToken, provider: aiProvider, job }),
      );
    } catch {
      /* private mode — the fields still work until refresh */
    }
  }, [sessionReady, workerMode, workerUrl, workerToken, aiProvider, job]);

  useEffect(() => {
    try {
      setGeminiKey(localStorage.getItem(GEMINI_KEY_STORAGE) ?? "");
      const bench = localStorage.getItem(BENCH_KEY);
      if (bench) {
        const parsed = JSON.parse(bench) as { colab?: unknown; kaggle?: unknown };
        if (typeof parsed.colab === "string") setColabUrl(parsed.colab);
        if (typeof parsed.kaggle === "string") setKaggleUrl(parsed.kaggle);
      }
    } catch {
      /* private mode — the fields still work until refresh */
    } finally {
      setKeysReady(true);
    }
  }, []);

  useEffect(() => {
    if (!keysReady) return;
    try {
      const key = geminiKey.trim();
      if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
      else localStorage.removeItem(GEMINI_KEY_STORAGE);
      localStorage.setItem(BENCH_KEY, JSON.stringify({ colab: colabUrl.trim(), kaggle: kaggleUrl.trim() }));
    } catch {
      /* private mode */
    }
  }, [keysReady, geminiKey, colabUrl, kaggleUrl]);

  function restoreSample() {
    setProject(SAMPLE);
    setDraft(SAMPLE_TEXT);
    setError(null);
    setNotice("Sample chapter restored, with the four painted panels.");
    setTab("strip");
  }

  function onCut() {
    setError(null);
    const cleaned = sanitizeNovelText(draft);
    if (cleaned !== draft) setDraft(cleaned);
    const next = keepPrivacy(cutChapter(cleaned), project);
    setProject(next);
    setNotice(next.source === "sample" ? "Sample kept, paintings included." : "Cut on this phone. Soul and vessel are split from the names you wrote.");
    setTab(next.source === "sample" ? "strip" : "forge");
  }

  async function onDirect() {
    const cleaned = sanitizeNovelText(draft);
    if (cleaned !== draft) setDraft(cleaned);
    const chunks = chunkChapterText(cleaned);
    if (!chunks.length) {
      setError("Paste at least a short chapter.");
      return;
    }
    setError(null);
    const parts: Project[] = [];
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        setBusy(chunks.length > 1 ? `Directing part ${index + 1} of ${chunks.length}` : "Directing the chapter");
        const result = await directChapter({
          data: { text: chunks[index], provider: aiProvider, workerUrl, workerToken, geminiKey: geminiKey.trim() },
        });
        if (!result.ok) {
          setError(chunks.length > 1 ? `Part ${index + 1}: ${result.error}` : result.error);
          return;
        }
        parts.push({
          ...result.direction,
          source: "grok",
          text: chunks[index],
        });
      }
      const merged = keepPrivacy(mergeCuts(parts), project);
      setProject({ ...merged, source: "grok", text: draft });
      setNotice(
        chunks.length > 1
          ? `Directed in ${chunks.length} parts so the ending was not dropped. ${merged.scenes.length} scenes kept.`
          : aiProvider === "worker"
            ? "The worker directed this cut. Paintings were cleared so the new panels are not the sample."
            : "Gemini directed this cut. Paintings were cleared so the new panels are not the sample.",
      );
      setTab("forge");
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
        const next = keepPrivacy(projectFromChapters(fetched), project);
        setProject(next);
        setDraft(next.text);
        setNotice(
          `${fetched.length} chapters fetched on their own. ${next.scenes.length} scenes kept. Nothing was cut at 8,000 characters or 6 scenes.`,
        );
        setTab("forge");
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
      setNotice("Page text is in the script. Site menus, chapter counters, and WTR-LAB chrome were dropped.");
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
    for (let index = 0; index < targets.length; index += 1) {
      const scene = targets[index];
      setBusy(`Painting panel ${index + 1} of ${targets.length}`);
      try {
        const result = await paintPanel({
          data: { prompt: scene.imagePrompt, provider: aiProvider, workerUrl, workerToken, geminiKey: geminiKey.trim() },
        });
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
              `c${chapter.index}-${item.id}` === scene.id ? { ...item, imageUrl: result.url } : item,
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
      const result = await speakLine({
        data: { text, voice: project.voice, provider: aiProvider, workerUrl, workerToken, geminiKey: geminiKey.trim() },
      });
      if (result.ok) {
        synth?.cancel();
        const mime = result.mimeType || "audio/mpeg";
        const src = `data:${mime};base64,${result.audioBase64}`;
        setTrack(src);
        try {
          await new Audio(src).play();
          setNotice(aiProvider === "worker" ? "Played the worker voice." : "Played the Gemini voice.");
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
        setError("Voice did not start. Tap Read again — this phone only allows speech from that tap.");
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

  async function onDownload() {
    setBusy("Composing the strip");
    setError(null);
    try {
      const blob = await renderStripPng(project);
      downloadBlob(blob, `${project.title.replace(/[^\w]+/g, "-").toLowerCase() || "aether"}-strip.png`);
      setNotice("Strip saved. Bubbles and hits are drawn on the picture, not inside the painting.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the strip.");
    } finally {
      setBusy(null);
    }
  }

  async function onCopy(value: string, label: string) {
    const ok = await copyText(value);
    setNotice(ok ? `${label} copied.` : `Could not copy ${label.toLowerCase()} on this phone.`);
  }

  async function onTestConnection() {
    setBusy("Testing the worker");
    setError(null);
    try {
      const result = await testWorker({ data: { url: workerUrl, token: workerToken } });
      if (!result.ok) {
        setError(result.body ? `${result.error} ${result.body}` : result.error);
        return;
      }
      setNotice(`Worker answered ${result.status}. ${result.body || "Health is clear."}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The worker did not answer.");
    } finally {
      setBusy(null);
    }
  }

  async function onSendJob() {
    setBusy("Sending the job packet");
    setError(null);
    try {
      const result = await submitJob({ data: { url: workerUrl, token: workerToken, packet: jobPacket(project) } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.jobId) {
        setJob({ id: result.jobId, status: "queued", progress: 0, label: "Accepted", error: "", mp4Url: null });
        setNotice(`Worker accepted the packet. Watching job ${result.jobId}.`);
        setTab("bay");
      } else {
        setJob(null);
        setNotice(`Worker accepted the packet (${result.status}), but the reply had no job id to watch.`);
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

  function onDownloadJob() {
    setError(null);
    try {
      const packet = jobPacket(project);
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      downloadBlob(blob, "job.json");
      setNotice("job.json saved. It follows job packet v2.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export job.json.");
    }
  }

  async function onDownloadMp4() {
    if (!job) return;
    setBusy("Fetching the MP4");
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
      setNotice("MP4 saved from the worker.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The MP4 did not download.");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof ScrollText }[] = [
    { id: "story", label: "Script", icon: ScrollText },
    { id: "forge", label: "Cast", icon: Sparkles },
    { id: "strip", label: "Strip", icon: Clapperboard },
    { id: "bay", label: "Bay", icon: Factory },
    { id: "youtube", label: "YouTube", icon: Youtube },
  ];

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
        {!showSettings ? <InstallHint /> : null}
        {showSettings ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Settings</h2>
              <p className="mt-2 text-sm text-muted">
                The worker address and token stay in this browser tab. They are not saved with the chapter.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Studio mode">
              <button
                type="button"
                aria-pressed={workerMode === "live"}
                onClick={() => setWorkerMode("live")}
                className={`min-h-12 rounded-2xl px-3 text-sm font-semibold ${workerMode === "live" ? "bg-seal text-paper" : "bg-panel text-paper"}`}
              >
                Live worker
              </button>
              <button
                type="button"
                aria-pressed={workerMode === "packet"}
                onClick={() => setWorkerMode("packet")}
                className={`min-h-12 rounded-2xl px-3 text-sm font-semibold ${workerMode === "packet" ? "bg-seal text-paper" : "bg-panel text-paper"}`}
              >
                Job packet
              </button>
            </div>
            <label className="block" htmlFor="worker-url">
              <span className="text-sm font-medium text-paper">Worker URL</span>
              <input
                id="worker-url"
                value={workerUrl}
                onChange={(event) => setWorkerUrl(event.target.value)}
                placeholder="https://worker.example.com"
                inputMode="url"
                autoComplete="off"
                className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
              />
            </label>
            <label className="block" htmlFor="worker-token">
              <span className="text-sm font-medium text-paper">Token</span>
              <input
                id="worker-token"
                type="password"
                value={workerToken}
                onChange={(event) => setWorkerToken(event.target.value)}
                autoComplete="off"
                className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
              />
            </label>
            <button
              type="button"
              onClick={onTestConnection}
              disabled={!!busy || !workerUrl.trim()}
              className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50"
            >
              Test connection
            </button>
            <p className="text-xs text-muted">
              Test calls GET /api/v1/health with the header X-Aether-Token. Private addresses stay blocked.{" "}
              {workerMode === "live" ? "Bay can send the packet to this worker." : "Bay keeps the packet on this phone for Kaggle or Colab."}
            </p>
            <div>
              <h3 className="text-lg text-paper">Director</h3>
              <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="AI provider">
                <button
                  type="button"
                  aria-pressed={aiProvider === "gemini"}
                  onClick={() => setAiProvider("gemini")}
                  className={`min-h-12 rounded-2xl px-3 text-sm font-semibold ${aiProvider === "gemini" ? "bg-seal text-paper" : "bg-panel text-paper"}`}
                >
                  Gemini
                </button>
                <button
                  type="button"
                  aria-pressed={aiProvider === "worker"}
                  onClick={() => setAiProvider("worker")}
                  className={`min-h-12 rounded-2xl px-3 text-sm font-semibold leading-tight ${aiProvider === "worker" ? "bg-seal text-paper" : "bg-panel text-paper"}`}
                >
                  Open-source worker
                </button>
              </div>
              <label className="mt-3 block" htmlFor="gemini-key">
                <span className="flex items-center justify-between gap-3 text-sm font-medium text-paper">
                  Gemini API key
                  <button
                    type="button"
                    onClick={() => setRevealKey((open) => !open)}
                    className="text-xs font-semibold text-cinnabar"
                  >
                    {revealKey ? "Hide" : "Show"}
                  </button>
                </span>
                <input
                  id="gemini-key"
                  type={revealKey ? "text" : "password"}
                  value={geminiKey}
                  onChange={(event) => setGeminiKey(event.target.value)}
                  placeholder="Paste a key from Google AI Studio"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none"
                />
              </label>
              <p className="mt-2 text-xs text-muted">
                {geminiKey.trim()
                  ? "Saved in this browser only. Direct, paint, and Gemini voice use this key. No model picker and no server key."
                  : "Paste a key here. It stays in this browser. You do not pick a model, and a server environment key is not required."}
              </p>
              {geminiKey.trim() ? (
                <button type="button" onClick={() => setGeminiKey("")} className="mt-2 min-h-11 text-sm font-semibold text-cinnabar">
                  Clear saved key
                </button>
              ) : null}
            </div>
            <BenchLinks colabUrl={colabUrl} kaggleUrl={kaggleUrl} onColab={setColabUrl} onKaggle={setKaggleUrl} />
          </section>
        ) : null}

        {!showSettings && tab === "story" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Cut the chapter</h2>
              <p className="mt-2 text-sm text-muted">
                Paste a chapter or pull a public page. Site menus and counters are stripped before the cut, the dialogue, and the YouTube card.
              </p>
            </div>
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
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onCut} disabled={!!busy} className="min-h-12 rounded-2xl bg-seal px-3 text-sm font-semibold text-paper disabled:opacity-50">
                Cut on this phone
              </button>
              <button type="button" onClick={onDirect} disabled={!!busy} className="min-h-12 rounded-2xl bg-panel px-3 text-sm font-semibold text-paper disabled:opacity-50">
                Direct this chapter
              </button>
              <button type="button" onClick={restoreSample} className="min-h-12 rounded-2xl bg-panel px-3 text-sm text-paper">
                Restore sample
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setNotice("Script cleared.");
                }}
                className="min-h-12 rounded-2xl bg-panel px-3 text-sm text-paper"
              >
                Clear script
              </button>
            </div>
            <div className="rounded-2xl bg-ink-2 p-4">
              <label className="block text-sm font-medium text-paper" htmlFor="source-url">
                Chapter link
              </label>
              <input
                id="source-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/story/chapter-{n}"
                inputMode="url"
                className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block text-sm text-paper" htmlFor="chapter-start">
                  Start
                  <input
                    id="chapter-start"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                    inputMode="numeric"
                    placeholder="1"
                    className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
                  />
                </label>
                <label className="block text-sm text-paper" htmlFor="chapter-end">
                  End
                  <input
                    id="chapter-end"
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                    inputMode="numeric"
                    placeholder="12"
                    className="field mt-2 min-h-12 w-full rounded-xl px-3 text-base outline-none placeholder:text-muted"
                  />
                </label>
              </div>
              <button type="button" onClick={onFetch} disabled={!!busy || !url.trim()} className="mt-3 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                {rangeStart.trim() || rangeEnd.trim() ? "Pull chapter range" : "Pull readable text"}
              </button>
              <p className="mt-2 text-xs text-muted">
                Leave start and end empty for one page. For a range, put {"{n}"} in the link, or paste one chapter URL and the last number is replaced. The range you type is what gets pulled. Private addresses stay blocked.
              </p>
            </div>
          </section>
        ) : null}

        {!showSettings && tab === "forge" ? (
          <section className="space-y-5">
            <div>
              <h2 className="text-3xl text-paper">Soul and vessel</h2>
              <p className="mt-2 text-sm text-muted">{project.logline}</p>
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
            <div>
              <h3 className="text-lg text-paper">State timeline</h3>
              <ul className="mt-2 space-y-2">
                {project.timeline.map((note) => (
                  <li key={note} className="rounded-xl bg-panel px-3 py-2 text-sm text-paper">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" onClick={onPaint} disabled={!!busy} className="min-h-12 w-full rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              Paint unpainted panels
            </button>
            <p className="text-xs text-muted">Every unpainted panel in this chapter is painted, one after another, only when you ask. Text hits and bubbles are drawn afterward, never inside the painting.</p>
          </section>
        ) : null}

        {!showSettings && tab === "strip" ? (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-3xl text-paper">The strip</h2>
              <button type="button" onClick={() => setWide((value) => !value)} className="min-h-11 rounded-full bg-panel px-4 text-sm text-paper">
                {wide ? "Vertical" : "16:9 wings"}
              </button>
            </div>
            <div className="space-y-4">
              {project.scenes.map((scene) => (
                <div key={scene.id} className="relative">
                  <PanelArt scene={scene} wide={wide} />
                </div>
              ))}
            </div>
            <button type="button" onClick={onDownload} disabled={!!busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
              <Download className="size-4" aria-hidden />
              Save strip
            </button>
          </section>
        ) : null}

        {!showSettings && tab === "bay" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-3xl text-paper">Factory bay</h2>
              <p className="mt-2 text-sm text-muted">
                {workerMode === "live"
                  ? "Live worker is on. Send the job packet from here. The token never leaves this tab except on that request."
                  : "Kaggle is the GPU bench: a free T4 session lasts longer than Colab and will not drop mid-chapter. Colab is only the backup when you want the file in Google Drive. Neither one can be a live door from this phone, so you hand over a job packet."}
              </p>
            </div>
            <BenchLinks colabUrl={colabUrl} kaggleUrl={kaggleUrl} onColab={setColabUrl} onKaggle={setKaggleUrl} />
            <div className="rounded-2xl bg-ink-2 p-4">
              <div className="flex items-center gap-2">
                <Mic className="size-4 text-cinnabar" aria-hidden />
                <h3 className="text-lg text-paper">Male voice lock</h3>
              </div>
              <p className="mt-2 text-sm text-paper">{project.narration}</p>
              <button type="button" onClick={onSpeak} disabled={!!busy} className="mt-3 min-h-12 w-full rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
                Read it, male voice only
              </button>
              <p className="mt-2 text-xs text-muted">Gemini voice if a key is saved. Otherwise this phone reads it. Android waits for its voice list before speaking, and a missing male label no longer stops the read.</p>
            </div>
            <div className="rounded-2xl bg-ink-2 p-4">
              <h3 className="text-lg text-paper">Job packet</h3>
              <p className="mt-2 text-xs text-muted">
                Title, description, tags, and privacy live on the YouTube tab. This file does not include that privacy choice, and it does not include the worker token. Nothing here signs into YouTube.
              </p>
              <button type="button" className="mt-3 min-h-11 w-full rounded-xl bg-panel text-sm text-paper" onClick={() => onCopy(JSON.stringify(jobPacket(project), null, 2), "Job packet")}>
                Copy job packet
              </button>
              <button type="button" onClick={onDownloadJob} disabled={!!busy} className="mt-2 min-h-12 w-full rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                Download job.json
              </button>
              {workerMode === "live" ? (
                <button type="button" onClick={onSendJob} disabled={!!busy} className="mt-2 min-h-12 w-full rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50">
                  Send to worker
                </button>
              ) : null}
            </div>
            <div className="rounded-2xl bg-ink-2 p-4">
              <h3 className="text-lg text-paper">Job status</h3>
              {job ? (
                <div className="mt-3" aria-live="polite">
                  <p className="text-sm text-paper">
                    {job.id} · {job.status}
                    {job.label ? ` · ${job.label}` : ""}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-cinnabar" style={{ width: `${job.progress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted">{job.progress}% from the worker. This is not a guess.</p>
                  {job.error ? <p className="mt-2 text-sm text-paper">{job.error}</p> : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={onSendJob} disabled={!!busy || workerMode !== "live"} className="min-h-12 rounded-xl bg-panel text-sm font-semibold text-paper disabled:opacity-50">
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={onDownloadMp4}
                      disabled={!!busy || (job.status !== "done" && !job.mp4Url)}
                      className="min-h-12 rounded-xl bg-seal text-sm font-semibold text-paper disabled:opacity-50"
                    >
                      Download MP4
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  {workerMode === "live"
                    ? "Send the packet. This screen then polls the worker and shows its progress, errors, and the MP4 when the job is done."
                    : "Switch to Live worker and send a packet to watch a job. Job packet mode only downloads job.json."}
                </p>
              )}
            </div>
            <ol className="space-y-2 text-sm text-paper">
              <li className="rounded-xl bg-panel px-3 py-2">1. Cut the chapter in Script.</li>
              <li className="rounded-xl bg-panel px-3 py-2">2. Copy the job packet.</li>
              <li className="rounded-xl bg-panel px-3 py-2">3. Kaggle, new notebook, GPU T4, upload job.json. Colab works with the same cell if you prefer Drive.</li>
              <li className="rounded-xl bg-panel px-3 py-2">4. Paste the factory cell. It draws bubbles, locks a male voice, trims edge silence, and writes an MP4.</li>
            </ol>
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
          <YoutubePreview
            project={project}
            onChange={(seo) => setProject((current) => ({ ...current, seo: { ...current.seo, ...seo } }))}
            onCopyCard={(text) => {
              void onCopy(text, "YouTube card");
            }}
          />
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
