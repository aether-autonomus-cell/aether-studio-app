import { useEffect, useMemo, useState } from "react";
import {
  Code2,
  Download,
  Eye,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { compileDownloadBundleHtml } from "@/lib/studio/compiler";
import {
  STARTER_ANIME_RIG_CODE,
  sceneGraphV1Schema,
  type LanguageCode,
  type SceneGraphV1,
  type SceneNode,
  type TemplateId,
  type TransitionType,
} from "@/lib/studio/schema";
import {
  estimateTimelineForJob,
  findSceneAtFrame,
  formatTimecode,
} from "@/lib/studio/timing";
import { PreviewFrame } from "./preview-frame";

interface CodePreviewTabProps {
  job: SceneGraphV1;
  onUpdateJob: (next: SceneGraphV1, note?: string, recordRevision?: boolean) => void;
}

type AuthorMode = "structured" | "custom-code";
type MobilePane = "preview" | "code";

const TEMPLATE_IDS: TemplateId[] = [
  "hook-card@1",
  "manhwa-dialogue@1",
  "action-pan@1",
  "cause-effect@1",
  "comparison@1",
  "recap-payoff@1",
  "custom-canvas@1",
];

export function CodePreviewTab({ job, onUpdateJob }: CodePreviewTabProps) {
  const [previewLang, setPreviewLang] = useState<LanguageCode>(
    job.project.languages[0] ?? "hi-IN",
  );
  const [authorMode, setAuthorMode] = useState<AuthorMode>("structured");
  const [mobilePane, setMobilePane] = useState<MobilePane>("preview");
  const [selectedSceneIdx, setSelectedSceneIdx] = useState(0);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);

  // Raw JSON editor state (validates via Zod without overwriting last valid revision)
  const [rawJsonDraft, setRawJsonDraft] = useState(() => JSON.stringify(job, null, 2));
  const [jsonDiagnostics, setJsonDiagnostics] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  // Custom 2D Code Mode state
  const [customKind, setCustomKind] = useState<"canvas2d" | "svg" | "p5">("canvas2d");
  const [customCode, setCustomCode] = useState(STARTER_ANIME_RIG_CODE);

  useEffect(() => {
    setRawJsonDraft(JSON.stringify(job, null, 2));
  }, [job]);

  const timeline = useMemo(
    () => estimateTimelineForJob(job, previewLang),
    [job, previewLang],
  );

  useEffect(() => {
    setFrameIndex((prev) => Math.min(prev, Math.max(0, timeline.totalFrames - 1)));
  }, [timeline.totalFrames]);

  useEffect(() => {
    if (!playing) return;
    const msPerFrame = 1000 / job.project.fps;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % timeline.totalFrames);
    }, msPerFrame);
    return () => window.clearInterval(id);
  }, [playing, job.project.fps, timeline.totalFrames]);

  const currentLookup = useMemo(
    () => findSceneAtFrame(timeline, frameIndex),
    [timeline, frameIndex],
  );

  // Optional browser speech preview synced with active scene
  useEffect(() => {
    if (!speechEnabled || !playing || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const scene = job.project.scenes[currentLookup.sceneIndex];
    const line = scene?.narration[previewLang]?.trim();
    if (!line) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(line);
    utter.lang = previewLang;
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  }, [speechEnabled, playing, currentLookup.sceneIndex, previewLang, job.project.scenes]);

  useEffect(() => {
    if (!speechEnabled && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [speechEnabled]);

  const safeSceneIdx = Math.max(0, Math.min(job.project.scenes.length - 1, selectedSceneIdx));
  const activeScene = job.project.scenes[safeSceneIdx];

  const updateActiveScene = (patch: Partial<SceneNode>) => {
    const nextScenes = job.project.scenes.map((s, i) =>
      i === safeSceneIdx ? { ...s, ...patch } : s,
    );
    onUpdateJob({
      ...job,
      project: { ...job.project, scenes: nextScenes },
    });
  };

  const handleApplyRawJson = () => {
    try {
      const parsedObj = JSON.parse(rawJsonDraft);
      const result = sceneGraphV1Schema.safeParse(parsedObj);
      if (!result.success) {
        const msg = result.error.issues
          .map((iss) => `${iss.path.join(".") || "root"}: ${iss.message}`)
          .slice(0, 3)
          .join(" | ");
        setJsonDiagnostics(msg);
        return;
      }
      setJsonDiagnostics(null);
      onUpdateJob(
        { ...result.data, project_revision: job.project_revision + 1 },
        "Applied SceneGraphV1 JSON edit",
        true,
      );
    } catch (err) {
      setJsonDiagnostics(String(err instanceof Error ? err.message : err));
    }
  };

  const handleDownloadHtmlBundle = () => {
    const html = compileDownloadBundleHtml(
      job,
      previewLang,
      authorMode === "custom-code"
        ? { enabled: true, kind: customKind, code: customCode }
        : undefined,
    );
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.project_id}-${previewLang}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddScene = () => {
    if (job.project.scenes.length >= 120) return;
    const newId = `s${job.project.scenes.length + 1}`;
    const nextScene: SceneNode = {
      id: newId,
      template_id: "manhwa-dialogue@1",
      narration: {
        "hi-IN": `नया दृश्य ${job.project.scenes.length + 1}।`,
        "en-US": `New scene ${job.project.scenes.length + 1}.`,
      },
      duration_hint_sec: 4.5,
      pause_after_ms: 280,
      transition: "dissolve",
      props: {
        headline: {
          "hi-IN": `दृश्य ${job.project.scenes.length + 1}`,
          "en-US": `SCENE ${job.project.scenes.length + 1}`,
        },
        character: {
          archetype: "hero-noir",
          pose: "determined",
          gaze: "camera",
          mouthState: "auto",
          hairFlow: 0.7,
        },
        backdrop: { mood: "skyline", scrim: 0.55 },
      },
      camera: [{ at: 0, x: 0.5, y: 0.5, zoom: 1, shake: 0 }],
    };
    onUpdateJob(
      {
        ...job,
        project_revision: job.project_revision + 1,
        project: { ...job.project, scenes: [...job.project.scenes, nextScene] },
      },
      `Added scene ${newId}`,
      true,
    );
    setSelectedSceneIdx(job.project.scenes.length);
  };

  const handleRemoveScene = (idx: number) => {
    if (job.project.scenes.length <= 1) return;
    const nextScenes = job.project.scenes.filter((_, i) => i !== idx);
    onUpdateJob(
      {
        ...job,
        project_revision: job.project_revision + 1,
        project: { ...job.project, scenes: nextScenes },
      },
      "Removed scene",
      true,
    );
    setSelectedSceneIdx(Math.max(0, idx - 1));
  };

  const customOverride =
    authorMode === "custom-code"
      ? { enabled: true, kind: customKind, code: customCode }
      : undefined;

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="studio-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-700 bg-slate-950/75 p-1 text-xs">
            <button
              type="button"
              onClick={() => setAuthorMode("structured")}
              className={`rounded-lg px-3 py-1 font-semibold transition ${
                authorMode === "structured"
                  ? "bg-cyan-400 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Structured Scenes
            </button>
            <button
              type="button"
              onClick={() => setAuthorMode("custom-code")}
              className={`rounded-lg px-3 py-1 font-semibold transition ${
                authorMode === "custom-code"
                  ? "bg-violet-400 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Custom 2D Code
            </button>
          </div>

          <div className="flex rounded-xl border border-slate-700 bg-slate-950/75 p-1 text-xs">
            {(["hi-IN", "en-US"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setPreviewLang(lang)}
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  previewLang === lang
                    ? "bg-amber-300 text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {lang === "hi-IN" ? "HI Preview" : "EN Preview"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mobile Preview/Code toggle */}
          <div className="flex rounded-xl border border-slate-700 bg-slate-950/75 p-1 text-xs lg:hidden">
            <button
              type="button"
              onClick={() => setMobilePane("preview")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold ${
                mobilePane === "preview" ? "bg-cyan-400 text-slate-950" : "text-slate-300"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => setMobilePane("code")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold ${
                mobilePane === "code" ? "bg-cyan-400 text-slate-950" : "text-slate-300"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadHtmlBundle}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
          >
            <Download className="h-3.5 w-3.5" />
            Download HTML Bundle
          </button>
        </div>
      </div>

      {/* Desktop Split View */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left/Code Pane */}
        <div
          className={`space-y-4 lg:col-span-7 ${
            mobilePane === "code" ? "block" : "hidden lg:block"
          }`}
        >
          {authorMode === "structured" ? (
            <div className="studio-card rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-100">
                  Scenes ({job.project.scenes.length} / 120)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRawJson((v) => !v)}
                    className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-400"
                  >
                    {showRawJson ? "Form Editor" : "Raw SceneGraphV1 JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddScene}
                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Scene
                  </button>
                </div>
              </div>

              {/* Scene Chips */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {job.project.scenes.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedSceneIdx(idx);
                      const boundary = timeline.scenes[idx];
                      if (boundary) setFrameIndex(boundary.startFrame);
                    }}
                    className={`rounded-lg border px-2.5 py-1 font-mono text-xs transition ${
                      idx === safeSceneIdx
                        ? "border-cyan-400 bg-cyan-500/25 font-bold text-cyan-100"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {s.id}
                  </button>
                ))}
              </div>

              {showRawJson ? (
                <div className="mt-4 space-y-2">
                  <textarea
                    rows={16}
                    value={rawJsonDraft}
                    onChange={(e) => setRawJsonDraft(e.target.value)}
                    className="studio-input w-full rounded-xl p-3 font-mono text-xs"
                  />
                  {jsonDiagnostics && (
                    <div className="rounded-lg border border-rose-500/50 bg-rose-950/50 p-2.5 text-xs text-rose-200">
                      Zod validation error: {jsonDiagnostics}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleApplyRawJson}
                      className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950"
                    >
                      Validate & Apply JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRawJsonDraft(JSON.stringify(job, null, 2));
                        setJsonDiagnostics(null);
                      }}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300"
                    >
                      Revert Draft
                    </button>
                  </div>
                </div>
              ) : (
                activeScene && (
                  <div className="mt-4 space-y-3 border-t border-slate-700/60 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-cyan-300">
                        Editing {activeScene.id}
                      </span>
                      {job.project.scenes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveScene(safeSceneIdx)}
                          className="inline-flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete Scene
                        </button>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Template</span>
                        <select
                          value={activeScene.template_id}
                          onChange={(e) =>
                            updateActiveScene({ template_id: e.target.value as TemplateId })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          {TEMPLATE_IDS.map((tid) => (
                            <option key={tid} value={tid}>
                              {tid}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Transition</span>
                        <select
                          value={activeScene.transition}
                          onChange={(e) =>
                            updateActiveScene({ transition: e.target.value as TransitionType })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="dissolve">Dissolve</option>
                          <option value="wipe">Wipe</option>
                          <option value="slide">Slide</option>
                          <option value="cut">Cut</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Pause After (ms)</span>
                        <input
                          type="number"
                          min={0}
                          max={2000}
                          step={40}
                          value={activeScene.pause_after_ms}
                          onChange={(e) =>
                            updateActiveScene({
                              pause_after_ms: Math.max(0, Math.min(2000, Number(e.target.value) || 0)),
                            })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Headline (EN)</span>
                        <input
                          type="text"
                          value={activeScene.props?.headline?.["en-US"] ?? ""}
                          onChange={(e) =>
                            updateActiveScene({
                              props: {
                                ...activeScene.props,
                                headline: {
                                  "hi-IN": activeScene.props?.headline?.["hi-IN"] ?? "",
                                  "en-US": e.target.value,
                                },
                              },
                            })
                          }
                          className="studio-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">शीर्षक (HI)</span>
                        <input
                          type="text"
                          value={activeScene.props?.headline?.["hi-IN"] ?? ""}
                          onChange={(e) =>
                            updateActiveScene({
                              props: {
                                ...activeScene.props,
                                headline: {
                                  "en-US": activeScene.props?.headline?.["en-US"] ?? "",
                                  "hi-IN": e.target.value,
                                },
                              },
                            })
                          }
                          className="studio-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Character Rig</span>
                        <select
                          value={activeScene.props?.character?.archetype ?? "hero-noir"}
                          onChange={(e) =>
                            updateActiveScene({
                              props: {
                                ...activeScene.props,
                                character: {
                                  archetype: e.target.value as
                                    | "hero-noir"
                                    | "mentor-sage"
                                    | "rival-crimson"
                                    | "analyst-cyan",
                                  pose: activeScene.props?.character?.pose ?? "determined",
                                  gaze: activeScene.props?.character?.gaze ?? "camera",
                                  mouthState: activeScene.props?.character?.mouthState ?? "auto",
                                  hairFlow: activeScene.props?.character?.hairFlow ?? 0.65,
                                },
                              },
                            })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="hero-noir">Hero Noir</option>
                          <option value="mentor-sage">Mentor Sage</option>
                          <option value="rival-crimson">Rival Crimson</option>
                          <option value="analyst-cyan">Analyst Cyan</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Pose</span>
                        <select
                          value={activeScene.props?.character?.pose ?? "determined"}
                          onChange={(e) =>
                            updateActiveScene({
                              props: {
                                ...activeScene.props,
                                character: {
                                  archetype: activeScene.props?.character?.archetype ?? "hero-noir",
                                  pose: e.target.value as
                                    | "idle"
                                    | "determined"
                                    | "pointing"
                                    | "stride"
                                    | "shocked",
                                  gaze: activeScene.props?.character?.gaze ?? "camera",
                                  mouthState: activeScene.props?.character?.mouthState ?? "auto",
                                  hairFlow: activeScene.props?.character?.hairFlow ?? 0.65,
                                },
                              },
                            })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="determined">Determined</option>
                          <option value="pointing">Pointing</option>
                          <option value="stride">Stride</option>
                          <option value="shocked">Shocked</option>
                          <option value="idle">Idle</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-slate-300">Speed-Lines</span>
                        <select
                          value={activeScene.props?.speedLines?.enabled ? "on" : "off"}
                          onChange={(e) =>
                            updateActiveScene({
                              props: {
                                ...activeScene.props,
                                speedLines: {
                                  enabled: e.target.value === "on",
                                  intensity: activeScene.props?.speedLines?.intensity ?? 0.45,
                                  originX: 0.5,
                                  originY: 0.44,
                                },
                              },
                            })
                          }
                          className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="on">Enabled</option>
                          <option value="off">Off</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="studio-card space-y-3 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Isolated Custom 2D Code Mode
                  </h3>
                  <p className="text-xs text-slate-300">
                    Implements deterministic window.Aether.init(bundle) & renderAt(frameIndex)
                  </p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={customKind}
                    onChange={(e) =>
                      setCustomKind(e.target.value as "canvas2d" | "svg" | "p5")
                    }
                    className="studio-input rounded-lg px-2.5 py-1 text-xs"
                  >
                    <option value="canvas2d">HTML5 Canvas 2D</option>
                    <option value="p5">p5.js (noLoop)</option>
                    <option value="svg">SVG Markup</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomKind("canvas2d");
                      setCustomCode(STARTER_ANIME_RIG_CODE);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Load Starter Anime Rig Code
                  </button>
                </div>
              </div>
              <textarea
                rows={18}
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                spellCheck={false}
                className="studio-input w-full rounded-xl p-3 font-mono text-xs"
              />
            </div>
          )}
        </div>

        {/* Right/Preview Pane */}
        <div
          className={`space-y-3 lg:col-span-5 ${
            mobilePane === "preview" ? "block" : "hidden lg:block"
          }`}
        >
          <PreviewFrame
            job={job}
            language={previewLang}
            timeline={timeline}
            frameIndex={frameIndex}
            customCode={customOverride}
          />

          {/* Player Controls & Scrubber */}
          <div className="studio-card space-y-2.5 rounded-2xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5DE6FF] to-[#A78BFA] px-3.5 py-1.5 text-xs font-bold text-slate-950"
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => setSpeechEnabled((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium ${
                    speechEnabled
                      ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                      : "border-slate-700 text-slate-300"
                  }`}
                >
                  {speechEnabled ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                  Voice Preview
                </button>
              </div>
              <div className="font-mono text-xs text-slate-300 tabular-nums">
                {formatTimecode(frameIndex / job.project.fps)} /{" "}
                {formatTimecode(timeline.totalDurationSec)}
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(0, timeline.totalFrames - 1)}
              value={frameIndex}
              onChange={(e) => {
                setPlaying(false);
                setFrameIndex(Number(e.target.value));
              }}
              aria-label="Frame Scrubber"
              className="w-full accent-[#5DE6FF]"
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Scene: <strong className="text-cyan-300">{currentLookup.scene.id}</strong> (
                {previewLang})
              </span>
              <span className="font-mono tabular-nums">
                Frame {frameIndex} / {timeline.totalFrames} @ {job.project.fps}fps
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
