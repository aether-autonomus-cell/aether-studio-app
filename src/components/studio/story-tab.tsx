import { useState } from "react";
import {
  ArrowRight,
  Cpu,
  Flame,
  Languages,
  Scissors,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  requestGenerateCompile,
  requestGenerateHooks,
  requestGeneratePackage,
  requestGenerateShorts,
  requestGenerateTranslate,
} from "@/lib/studio/api";
import { generateColabOptionalLlmCell } from "@/lib/studio/factory-cell";
import {
  render2DThumbnailSvg,
  type HooksBundle,
  type PackageBundle,
  type ShortsArc,
} from "@/lib/studio/hooks";
import {
  compileStoryDeterministic,
  type AiRouteProvider,
} from "@/lib/studio/provider-router";
import {
  MAX_STORY_CHARS,
  VOICE_BY_LANGUAGE,
  type AspectRatio,
  type ContentMode,
  type LanguageCode,
  type SceneGraphV1,
  type StyleId,
  type VisualMode,
} from "@/lib/studio/schema";

interface StoryTabProps {
  job: SceneGraphV1;
  onUpdateJob: (next: SceneGraphV1, note?: string, recordRevision?: boolean) => void;
  onCompileAndOpenPreview: (next: SceneGraphV1) => void;
}

const SAMPLE_STORY = `One quiet night in Jaipur, an engineer noticed the city lights flickering in a hidden three-second rhythm.
Everyone assumed it was an old grid fault.
But when she plotted the pulses on a 2D map, they formed an exact countdown leading to the old observatory.
Now she had sixty seconds before the signal vanished forever.`;

const STYLE_OPTIONS: { id: StyleId; label: string; colors: string }[] = [
  { id: "midnight-cyan@1", label: "Midnight Cyan", colors: "#070B16 · #5DE6FF" },
  { id: "crimson-sakuga@1", label: "Crimson Sakuga", colors: "#09060E · #FF4D6D" },
  { id: "amber-explainer@1", label: "Amber Explainer", colors: "#080D16 · #FFD166" },
  { id: "obsidian-gold@1", label: "Obsidian Gold", colors: "#060811 · #A78BFA" },
];

function RouteBadge({ route }: { route: AiRouteProvider }) {
  const label =
    route === "pollinations"
      ? "Route: Pollinations"
      : route === "colab-llm"
        ? "Route: Colab LLM"
        : "Route: Local Deterministic";
  const cls =
    route === "pollinations"
      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
      : route === "colab-llm"
        ? "border-violet-400/40 bg-violet-500/10 text-violet-200"
        : "border-amber-400/40 bg-amber-500/10 text-amber-200";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Cpu className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export function StoryTab({
  job,
  onUpdateJob,
  onCompileAndOpenPreview,
}: StoryTabProps) {
  const [rawStory, setRawStory] = useState<string>(SAMPLE_STORY);
  const [activeRoute, setActiveRoute] = useState<AiRouteProvider>("local-deterministic");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [showColabLlmBox, setShowColabLlmBox] = useState(false);
  const [colabOverrideJson, setColabOverrideJson] = useState("");

  const [hooksBundle, setHooksBundle] = useState<HooksBundle | null>(null);
  const [showAll21Hooks, setShowAll21Hooks] = useState(false);
  const [packageBundle, setPackageBundle] = useState<PackageBundle | null>(null);
  const [shortsArc, setShortsArc] = useState<ShortsArc | null>(null);

  const languages = job.project.languages;
  const langMode: "hi" | "en" | "both" =
    languages.includes("hi-IN") && languages.includes("en-US")
      ? "both"
      : languages.includes("hi-IN")
        ? "hi"
        : "en";

  const setLanguageMode = (mode: "hi" | "en" | "both") => {
    const nextLangs: LanguageCode[] =
      mode === "both" ? ["hi-IN", "en-US"] : mode === "hi" ? ["hi-IN"] : ["en-US"];
    onUpdateJob({
      ...job,
      project_revision: job.project_revision + 1,
      project: { ...job.project, languages: nextLangs },
    });
  };

  const handleCompileStory = async (openPreviewAfter: boolean) => {
    setBusyAction("compile");
    setStatusMessage(null);
    try {
      const res = await requestGenerateCompile({
        titleHi: job.project.title["hi-IN"],
        titleEn: job.project.title["en-US"],
        storyText: rawStory.trim() || job.project.scenes.map((s) => s.narration["en-US"]).join("\n"),
        mode: job.project.mode,
        aspectRatio: job.project.aspect_ratio,
        visualMode: job.project.visual_mode,
        styleId: job.project.style_id,
        languages: job.project.languages,
        colabOverrideJson: colabOverrideJson.trim() || undefined,
      });
      setActiveRoute(res.route);
      const merged: SceneGraphV1 = {
        ...res.data,
        project_id: job.project_id,
        project_revision: job.project_revision + 1,
        project: {
          ...res.data.project,
          resolution: job.project.resolution,
          fps: job.project.fps,
          outputs: job.project.outputs,
          bgm: job.project.bgm,
          publish_targets: job.project.publish_targets,
        },
      };
      setStatusMessage(
        `Compiled ${merged.project.scenes.length} synchronized 2D scenes (${res.latencyMs}ms).`,
      );
      if (openPreviewAfter) {
        onCompileAndOpenPreview(merged);
      } else {
        onUpdateJob(merged, "Story compiled to 2D SceneGraphV1", true);
      }
    } catch {
      const fallback = compileStoryDeterministic({
        titleHi: job.project.title["hi-IN"],
        titleEn: job.project.title["en-US"],
        storyText: rawStory,
        mode: job.project.mode,
        aspectRatio: job.project.aspect_ratio,
        visualMode: job.project.visual_mode,
        styleId: job.project.style_id,
        languages: job.project.languages,
        projectId: job.project_id,
        revision: job.project_revision + 1,
      });
      setActiveRoute("local-deterministic");
      setStatusMessage(`Compiled ${fallback.project.scenes.length} scenes locally offline.`);
      if (openPreviewAfter) onCompileAndOpenPreview(fallback);
      else onUpdateJob(fallback, "Local deterministic compile", true);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePairedTranslation = async () => {
    setBusyAction("translate");
    setStatusMessage(null);
    try {
      const res = await requestGenerateTranslate({
        job,
        colabOverrideJson: colabOverrideJson.trim() || undefined,
      });
      setActiveRoute(res.route);
      const map = new Map(res.data.scenes.map((s) => [s.id, s]));
      const nextScenes = job.project.scenes.map((scene) => {
        const match = map.get(scene.id);
        if (!match) return scene;
        return {
          ...scene,
          narration: {
            "hi-IN": match.hi_IN,
            "en-US": match.en_US,
          },
          props: {
            ...scene.props,
            headline: {
              "hi-IN": match.headline_hi ?? scene.props?.headline?.["hi-IN"] ?? "",
              "en-US": match.headline_en ?? scene.props?.headline?.["en-US"] ?? "",
            },
          },
        };
      });
      onUpdateJob(
        {
          ...job,
          project_revision: job.project_revision + 1,
          project: { ...job.project, scenes: nextScenes },
        },
        "Paired HI/EN translation sync",
        true,
      );
      setStatusMessage("Synchronized Hindi & English narration lines across locked scene IDs.");
    } catch (err) {
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleHooks = async () => {
    setBusyAction("hooks");
    setStatusMessage(null);
    try {
      const topic = job.project.title["en-US"] || rawStory.slice(0, 140);
      const res = await requestGenerateHooks({
        topic,
        colabOverrideJson: colabOverrideJson.trim() || undefined,
      });
      setActiveRoute(res.route);
      setHooksBundle(res.data);
    } catch (err) {
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyAction(null);
    }
  };

  const handlePackage = async () => {
    setBusyAction("package");
    setStatusMessage(null);
    try {
      const res = await requestGeneratePackage({
        job,
        colabOverrideJson: colabOverrideJson.trim() || undefined,
      });
      setActiveRoute(res.route);
      setPackageBundle(res.data);
    } catch (err) {
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleShorts = async () => {
    setBusyAction("shorts");
    setStatusMessage(null);
    try {
      const res = await requestGenerateShorts({
        job,
        colabOverrideJson: colabOverrideJson.trim() || undefined,
      });
      setActiveRoute(res.route);
      setShortsArc(res.data);
    } catch (err) {
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyAction(null);
    }
  };

  const applyHookToScene1 = (hookEn: string, hookHi: string) => {
    const nextScenes = job.project.scenes.map((s, idx) =>
      idx === 0
        ? {
            ...s,
            template_id: "hook-card@1" as const,
            narration: { "hi-IN": hookHi, "en-US": hookEn },
          }
        : s,
    );
    onUpdateJob(
      {
        ...job,
        project_revision: job.project_revision + 1,
        project: { ...job.project, scenes: nextScenes },
      },
      "Applied opening hook to Scene 1",
      true,
    );
    setStatusMessage("Hook applied to Scene 1 (HI + EN).");
  };

  const applyPackageToTargets = (conceptIdx: number) => {
    const c = packageBundle?.concepts[conceptIdx];
    if (!c) return;
    onUpdateJob(
      {
        ...job,
        project_revision: job.project_revision + 1,
        project: {
          ...job.project,
          publish_targets: {
            "hi-IN": {
              ...job.project.publish_targets["hi-IN"],
              title: c.title_hi.slice(0, 100),
              description: c.description_hi,
              tags: c.tags,
            },
            "en-US": {
              ...job.project.publish_targets["en-US"],
              title: c.title_en.slice(0, 100),
              description: c.description_en,
              tags: c.tags,
            },
          },
        },
      },
      `Applied package "${c.angle}" to Publish Targets`,
      true,
    );
    setStatusMessage(`Applied "${c.angle}" metadata to Hindi & English publish targets.`);
  };

  const applyShortsArc = () => {
    if (!shortsArc) return;
    const nextScenes = shortsArc.scenes.map((s, i) => ({
      id: `short_${i + 1}`,
      template_id:
        i === 0
          ? ("hook-card@1" as const)
          : i === shortsArc.scenes.length - 1
            ? ("recap-payoff@1" as const)
            : ("action-pan@1" as const),
      narration: { "hi-IN": s.narration_hi, "en-US": s.narration_en },
      duration_hint_sec: 7.5,
      pause_after_ms: 240,
      transition: "wipe" as const,
      props: {
        headline: { "hi-IN": s.headline_hi, "en-US": s.headline_en },
        speedLines: { enabled: true, intensity: 0.5, originX: 0.5, originY: 0.42 },
        backdrop: { mood: "skyline" as const, scrim: 0.55 },
      },
      camera: [
        { at: 0, x: 0.5, y: 0.5, zoom: 1.0, shake: 0 },
        { at: 1, x: 0.5, y: 0.48, zoom: 1.08, shake: 0.015 },
      ],
    }));
    onUpdateJob(
      {
        ...job,
        project_revision: job.project_revision + 1,
        project: {
          ...job.project,
          aspect_ratio: "9:16",
          title: { "hi-IN": shortsArc.title_hi, "en-US": shortsArc.title_en },
          scenes: nextScenes,
        },
      },
      "Extracted 9:16 Shorts vertical arc",
      true,
    );
    setStatusMessage("Loaded 9:16 vertical Shorts arc into active scenes.");
  };

  const displayedHooks = hooksBundle
    ? showAll21Hooks
      ? hooksBundle.hooks
      : hooksBundle.hooks.filter((h) => hooksBundle.top5Ids.includes(h.id))
    : [];

  return (
    <div className="space-y-5">
      {/* Header & Route Status */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-50">
              Story & Dual-Language Studio
            </h2>
            <p className="text-xs text-slate-300">
              Same 2D visuals, paired voices: {VOICE_BY_LANGUAGE["hi-IN"]} &{" "}
              {VOICE_BY_LANGUAGE["en-US"]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RouteBadge route={activeRoute} />
            <button
              type="button"
              onClick={() => setShowColabLlmBox((v) => !v)}
              className="rounded-lg border border-slate-600/70 bg-slate-900/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-cyan-400/60"
            >
              {showColabLlmBox ? "Hide Colab LLM Sync" : "Tier 2: Colab LLM"}
            </button>
          </div>
        </div>

        {showColabLlmBox && (
          <div className="mt-4 space-y-2 rounded-xl border border-violet-400/30 bg-slate-950/70 p-3">
            <p className="text-xs text-violet-200">
              Optional Tier 2: If Pollinations is rate-limited, run the open-source Colab LLM cell
              and paste its JSON output below before clicking Generate.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-black/50 p-2 text-[11px] text-slate-300">
              {generateColabOptionalLlmCell()}
            </pre>
            <textarea
              value={colabOverrideJson}
              onChange={(e) => setColabOverrideJson(e.target.value)}
              placeholder="Paste optional Colab LLM JSON response here..."
              rows={3}
              className="studio-input w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>
        )}

        {/* Project Controls Grid */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-300">Title (English)</span>
            <input
              type="text"
              value={job.project.title["en-US"]}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: {
                    ...job.project,
                    title: { ...job.project.title, "en-US": e.target.value },
                  },
                })
              }
              className="studio-input w-full rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-300">शीर्षक (हिंदी)</span>
            <input
              type="text"
              value={job.project.title["hi-IN"]}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: {
                    ...job.project,
                    title: { ...job.project.title, "hi-IN": e.target.value },
                  },
                })
              }
              className="studio-input w-full rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-300">Content Mode</span>
            <select
              value={job.project.mode}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: { ...job.project, mode: e.target.value as ContentMode },
                })
              }
              className="studio-input w-full rounded-lg px-3 py-2 text-sm"
            >
              <option value="manhwa-anime">Manhwa / Anime 2D</option>
              <option value="story">Narrative Story</option>
              <option value="explainer">Data & Flow Explainer</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-300">Aspect & Visual Mode</span>
            <div className="flex gap-2">
              <select
                value={job.project.aspect_ratio}
                onChange={(e) =>
                  onUpdateJob({
                    ...job,
                    project: { ...job.project, aspect_ratio: e.target.value as AspectRatio },
                  })
                }
                className="studio-input w-1/2 rounded-lg px-2 py-2 text-sm"
              >
                <option value="9:16">9:16 Vertical</option>
                <option value="16:9">16:9 Landscape</option>
              </select>
              <select
                value={job.project.visual_mode}
                onChange={(e) =>
                  onUpdateJob({
                    ...job,
                    project: { ...job.project, visual_mode: e.target.value as VisualMode },
                  })
                }
                className="studio-input w-1/2 rounded-lg px-2 py-2 text-sm"
              >
                <option value="pure-2d">Pure 2D</option>
                <option value="hybrid-2d">Hybrid T4</option>
              </select>
            </div>
          </label>
        </div>

        {/* Style & Language Track Selectors */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-300">Style Manifest:</span>
            {STYLE_OPTIONS.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() =>
                  onUpdateJob({
                    ...job,
                    project: { ...job.project, style_id: st.id },
                  })
                }
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  job.project.style_id === st.id
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-100"
                    : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950/70 p-1 text-xs">
            {(
              [
                { id: "both", label: "Both HI + EN" },
                { id: "hi", label: "Hindi Only" },
                { id: "en", label: "English Only" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLanguageMode(opt.id)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  langMode === opt.id
                    ? "bg-cyan-400 text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Story Input + Compile Bar */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="raw-story-input" className="text-sm font-semibold text-slate-100">
            Story / Script Input (Up to 30,000 characters)
          </label>
          <span className="text-xs text-slate-400 tabular-nums">
            {rawStory.length.toLocaleString()} / {MAX_STORY_CHARS.toLocaleString()} chars
          </span>
        </div>
        <textarea
          id="raw-story-input"
          value={rawStory}
          maxLength={MAX_STORY_CHARS}
          onChange={(e) => setRawStory(e.target.value)}
          rows={5}
          placeholder="Paste your Hindi or English story, manhwa narration, or explainer script..."
          className="studio-input mt-2 w-full rounded-xl p-3 text-sm"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => handleCompileStory(false)}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            {busyAction === "compile" ? "Compiling..." : "Story → 2D Scenes"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handlePairedTranslation}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-400/50 bg-violet-500/15 px-3.5 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-50"
          >
            <Languages className="h-4 w-4" />
            {busyAction === "translate" ? "Syncing..." : "Generate Paired Translation"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onCompileAndOpenPreview(job)}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5DE6FF] to-[#A78BFA] px-4 py-2 text-xs font-bold text-slate-950 shadow-lg hover:opacity-95"
          >
            Compile to 2D Code
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {statusMessage && (
          <p className="mt-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-100">
            {statusMessage}
          </p>
        )}
      </div>

      {/* YouTube Agent Skill Actions */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100">YouTube Agent Skill Tools</h3>
            <p className="text-xs text-slate-300">
              21-Hook Generator, Title + 2D Coded Thumbnail Packager, and 9:16 Shorts Extractor
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleHooks}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/25"
            >
              <Flame className="h-3.5 w-3.5" />
              Hooks (/yt-script)
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handlePackage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Package (/yt-package)
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleShorts}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/25"
            >
              <Scissors className="h-3.5 w-3.5" />
              Shorts (/yt-shorts)
            </button>
          </div>
        </div>

        {hooksBundle && (
          <div className="mt-4 space-y-2.5 border-t border-slate-700/60 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-200">
                {showAll21Hooks ? "All 21 Structured Hooks" : "Top 5 Shortlisted Hooks (from 21)"}
              </span>
              <button
                type="button"
                onClick={() => setShowAll21Hooks((v) => !v)}
                className="text-xs font-medium text-cyan-300 hover:underline"
              >
                {showAll21Hooks ? "Show Top 5 Shortlist" : `View All ${hooksBundle.hooks.length}`}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {displayedHooks.map((h) => (
                <div
                  key={h.id}
                  className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
                      {h.category}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyHookToScene1(h.hook_en, h.hook_hi)}
                      className="font-semibold text-amber-300 hover:underline"
                    >
                      Use on Scene 1
                    </button>
                  </div>
                  <p className="mt-1.5 font-medium text-slate-100">{h.hook_en}</p>
                  <p className="mt-1 text-slate-300">{h.hook_hi}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">{h.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {packageBundle && (
          <div className="mt-4 space-y-2.5 border-t border-slate-700/60 pt-3">
            <span className="text-xs font-semibold text-cyan-200">
              3 Synchronized Packaging + 2D Coded Thumbnail Concepts
            </span>
            <div className="grid gap-3 md:grid-cols-3">
              {packageBundle.concepts.map((c, idx) => {
                const svgMarkup = render2DThumbnailSvg(
                  c.thumbnail_headline_en,
                  c.thumbnail_headline_hi,
                  job.project.style_id,
                  c.thumbnail_accent,
                );
                const svgDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
                return (
                  <div
                    key={c.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 text-xs"
                  >
                    <div>
                      <img
                        src={svgDataUri}
                        alt={c.thumbnail_headline_en}
                        className="aspect-video w-full rounded-lg border border-slate-700/60 object-cover"
                      />
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                        {c.angle}
                      </p>
                      <p className="mt-1 font-semibold text-slate-100">{c.title_en}</p>
                      <p className="mt-0.5 text-slate-300">{c.title_hi}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyPackageToTargets(idx)}
                      className="mt-3 w-full rounded-lg border border-cyan-400/40 bg-cyan-500/15 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/25"
                    >
                      Apply to Publish Targets
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {shortsArc && (
          <div className="mt-4 rounded-xl border border-rose-400/30 bg-slate-950/70 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-rose-200">
                  9:16 Vertical Shorts Arc ({shortsArc.estimated_duration_sec}s ·{" "}
                  {shortsArc.scenes.length} beats)
                </span>
                <p className="text-slate-300">{shortsArc.title_en}</p>
              </div>
              <button
                type="button"
                onClick={applyShortsArc}
                className="rounded-lg bg-rose-500 px-3 py-1.5 font-semibold text-white hover:bg-rose-400"
              >
                Load Vertical Shorts Draft
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Synchronized Dual-Language Scene Lines */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            Scene-Locked Dual-Language Narration ({job.project.scenes.length} scenes)
          </h3>
          <span className="text-xs text-slate-400">Rev {job.project_revision}</span>
        </div>

        <div className="mt-3 space-y-3">
          {job.project.scenes.map((scene, idx) => (
            <div
              key={scene.id}
              className="rounded-xl border border-slate-700/70 bg-slate-950/55 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-cyan-300">
                  #{idx + 1} · {scene.id} ({scene.template_id})
                </span>
                <span className="text-slate-400">
                  ~{scene.duration_hint_sec}s · pause {scene.pause_after_ms}ms
                </span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-amber-200">Hindi ({VOICE_BY_LANGUAGE["hi-IN"]})</span>
                  <textarea
                    rows={2}
                    value={scene.narration["hi-IN"]}
                    onChange={(e) => {
                      const next = job.project.scenes.map((s) =>
                        s.id === scene.id
                          ? { ...s, narration: { ...s.narration, "hi-IN": e.target.value } }
                          : s,
                      );
                      onUpdateJob({
                        ...job,
                        project: { ...job.project, scenes: next },
                      });
                    }}
                    className="studio-input w-full rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-cyan-200">English ({VOICE_BY_LANGUAGE["en-US"]})</span>
                  <textarea
                    rows={2}
                    value={scene.narration["en-US"]}
                    onChange={(e) => {
                      const next = job.project.scenes.map((s) =>
                        s.id === scene.id
                          ? { ...s, narration: { ...s.narration, "en-US": e.target.value } }
                          : s,
                      );
                      onUpdateJob({
                        ...job,
                        project: { ...job.project, scenes: next },
                      });
                    }}
                    className="studio-input w-full rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
