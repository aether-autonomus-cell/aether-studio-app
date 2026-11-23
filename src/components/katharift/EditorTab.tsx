import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Lock,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { KrAudioStem, KrTimelineV1 } from "@/packages/contracts/schemas";
import { KR_FPS, formatTimecode } from "@/packages/contracts/timing";
import {
  applyMeasuredSilenceTrim,
  canAutoTrimSilenceSuggestion,
  commitEditorEdit,
  createEditorHistory,
  redoEditorHistory,
  rippleDeleteRange,
  splitAtFrame,
  trimClipInEdge,
  trimClipOutEdge,
  undoEditorHistory,
  updateAudioStem,
  type EditorHistoryStack,
} from "@/packages/editor/engine";
import {
  DEFAULT_TIMELINE_PX_PER_FRAME,
  clampZoomPxPerFrame,
  computeScrollLeftForPlayhead,
  computeTrimDeltaFrames,
  dbToLinearGain,
  frameFromTrackClientX,
} from "@/packages/editor/gestures";
import {
  classifyClipMediaStatus,
  getAudioPlaybackStatusSummary,
  type MediaLifecycleState,
  type MediaProbeMap,
} from "@/packages/editor/media-status";
import { krApiFetch, type WorkspaceSnapshot } from "./types";

interface EditorTabProps {
  workspace: WorkspaceSnapshot;
  onRefresh: () => Promise<void>;
}

type EditorToolPanel = "edit" | "audio" | "captions";

const TIMELINE_LEADING_PAD_PX = 16;

const STATE_BADGE_CLASS: Record<MediaLifecycleState, string> = {
  pending: "border-white/15 bg-black/70 text-slate-300",
  available: "border-amber-400/40 bg-amber-500/20 text-amber-200",
  validated: "border-emerald-400/40 bg-emerald-500/20 text-emerald-200",
  playback_error: "border-rose-400/40 bg-rose-500/25 text-rose-200",
};

export function EditorTab({ workspace, onRefresh }: EditorTabProps) {
  const [history, setHistory] = useState<EditorHistoryStack>(() =>
    createEditorHistory(workspace.timeline),
  );
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    workspace.timeline.clips[0]?.clip_id ?? null,
  );
  const [toolPanel, setToolPanel] = useState<EditorToolPanel>("edit");
  const [pxPerFrame, setPxPerFrame] = useState(DEFAULT_TIMELINE_PX_PER_FRAME);
  const [demoPreviewMode, setDemoPreviewMode] = useState(false);
  const [probeMap, setProbeMap] = useState<MediaProbeMap>({});
  const [audioPlaybackNotice, setAudioPlaybackNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastActionLabel, setLastActionLabel] = useState("Timeline edit");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [trimDragPreview, setTrimDragPreview] = useState<{
    clipId: string;
    edge: "in" | "out";
    deltaFrames: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const scrubActiveRef = useRef(false);
  const trimGestureRef = useRef<{
    clipId: string;
    edge: "in" | "out";
    startClientX: number;
    pointerId: number;
  } | null>(null);

  const timeline = history.present;
  const dirty = timeline.version !== workspace.timeline.version;
  const latestJob = workspace.jobs[0] ?? null;

  // Sync incoming server timeline when workspace updates and no unsaved local edits exist
  useEffect(() => {
    if (!dirty && workspace.timeline.timeline_id === timeline.timeline_id) {
      setHistory(createEditorHistory(workspace.timeline));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.timelineRevisionId]);

  const activeClip = useMemo(
    () =>
      timeline.clips.find(
        (c) => playheadFrame >= c.in_frame && playheadFrame < c.out_frame,
      ) ?? timeline.clips[0],
    [timeline.clips, playheadFrame],
  );

  const selectedClip = useMemo(
    () => timeline.clips.find((c) => c.clip_id === selectedClipId) ?? activeClip ?? null,
    [timeline.clips, selectedClipId, activeClip],
  );

  const activeCaption = useMemo(
    () =>
      timeline.captions.find(
        (c) => playheadFrame >= c.in_frame && playheadFrame < c.out_frame,
      ) ?? null,
    [timeline.captions, playheadFrame],
  );

  const sceneById = useMemo(
    () => new Map(workspace.storyRevision.bible.scenes.map((s) => [s.scene_id, s])),
    [workspace.storyRevision.bible.scenes],
  );

  const checkpointBySceneId = useMemo(
    () => new Map((latestJob?.checkpoints ?? []).map((cp) => [cp.scene_id, cp])),
    [latestJob],
  );

  const activeSceneMeta = activeClip ? sceneById.get(activeClip.scene_id) ?? null : null;
  const selectedSceneMeta = selectedClip ? sceneById.get(selectedClip.scene_id) ?? null : null;

  const activeClipMedia = useMemo(() => {
    if (!activeClip) return null;
    return classifyClipMediaStatus(
      activeClip,
      checkpointBySceneId.get(activeClip.scene_id) ?? null,
      probeMap,
    );
  }, [activeClip, checkpointBySceneId, probeMap]);

  const activeAudioDetail = useMemo(() => {
    if (!activeClipMedia) return null;
    return timeline.active_audio_lang === "hi"
      ? activeClipMedia.hiAudio
      : activeClipMedia.enAudio;
  }, [activeClipMedia, timeline.active_audio_lang]);

  const activeAudioPlayback = useMemo(() => {
    if (!activeAudioDetail) {
      return {
        canAttemptPlayback: false,
        isVerifiedPlayable: false,
        isSilentStoryboard: true,
        badgeText: "Silent Storyboard",
        detailText: "No active clip on timeline.",
      };
    }
    return getAudioPlaybackStatusSummary(activeAudioDetail, timeline.active_audio_lang);
  }, [activeAudioDetail, timeline.active_audio_lang]);

  const activeVoiceStem = useMemo(() => {
    const stemId = timeline.active_audio_lang === "hi" ? "voice_hi" : "voice_en";
    return timeline.stems.find((s) => s.stem_id === stemId) ?? timeline.stems[0];
  }, [timeline.stems, timeline.active_audio_lang]);

  const allClipMediaMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof classifyClipMediaStatus>>();
    for (const clip of timeline.clips) {
      map.set(
        clip.clip_id,
        classifyClipMediaStatus(clip, checkpointBySceneId.get(clip.scene_id) ?? null, probeMap),
      );
    }
    return map;
  }, [timeline.clips, checkpointBySceneId, probeMap]);

  const hasAnyValidatedAudio = useMemo(
    () =>
      timeline.clips.some((clip) => {
        const st = allClipMediaMap.get(clip.clip_id);
        return st?.hiAudio.state === "validated" || st?.enAudio.state === "validated";
      }),
    [timeline.clips, allClipMediaMap],
  );

  // 24fps storyboard/timeline playback loop
  useEffect(() => {
    if (!playing || timeline.total_frames <= 0) return;
    const id = window.setInterval(() => {
      setPlayheadFrame((prev) => {
        const next = prev + 1;
        return next >= timeline.total_frames ? 0 : next;
      });
    }, 1000 / KR_FPS);
    return () => window.clearInterval(id);
  }, [playing, timeline.total_frames]);

  // Keep playhead in view during playback
  useEffect(() => {
    if (!playing) return;
    const container = timelineScrollRef.current;
    if (!container) return;
    const targetLeft = computeScrollLeftForPlayhead({
      playheadFrame,
      pxPerFrame,
      viewportWidth: container.clientWidth,
      currentScrollLeft: container.scrollLeft,
      leadingPaddingPx: TIMELINE_LEADING_PAD_PX,
    });
    if (targetLeft !== container.scrollLeft) {
      container.scrollLeft = targetLeft;
    }
  }, [playing, playheadFrame, pxPerFrame]);

  // Real <audio> element sync & playback when an actual audio URL exists
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const url = activeAudioDetail?.url ?? null;
    if (!url || activeAudioDetail?.state === "playback_error") {
      audio.pause();
      return;
    }

    const gain = activeVoiceStem
      ? dbToLinearGain(activeVoiceStem.gain_db, activeVoiceStem.muted)
      : 1;
    audio.volume = gain;
    audio.muted = Boolean(activeVoiceStem?.muted);

    if (playing) {
      if (activeClip) {
        const targetSec = Math.max(
          0,
          (activeClip.source_in_frame + Math.max(0, playheadFrame - activeClip.in_frame)) / KR_FPS,
        );
        if (Math.abs(audio.currentTime - targetSec) > 0.25) {
          try {
            audio.currentTime = targetSec;
          } catch {
            /* ignore seek before metadata load */
          }
        }
      }
      if (audio.paused) {
        void audio.play().catch((err: unknown) => {
          const name = err instanceof Error ? err.name : "PlaybackError";
          if (name === "AbortError") return;
          setProbeMap((prev) => ({ ...prev, [url]: "playback_error" }));
          setAudioPlaybackNotice(
            err instanceof Error
              ? `Audio playback blocked or failed (${err.message})`
              : "Audio playback failed",
          );
        });
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [playing, activeAudioDetail, activeVoiceStem, activeClip, playheadFrame]);

  // Sync <video> frame when a real video plate is loaded
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip || activeClipMedia?.picture.kind !== "video") return;
    const targetSec = Math.max(
      0,
      (activeClip.source_in_frame + Math.max(0, playheadFrame - activeClip.in_frame)) / KR_FPS,
    );
    if (Math.abs(video.currentTime - targetSec) > 0.2) {
      try {
        video.currentTime = targetSec;
      } catch {
        /* ignore seek before metadata */
      }
    }
  }, [activeClip, activeClipMedia?.picture.kind, playheadFrame]);

  // Draw clean 16:9 storyboard backdrop (NO tiny/truncated on-canvas captions)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#0E1424");
    grad.addColorStop(0.55, "#1A2238");
    grad.addColorStop(1, "#2A1F33");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (activeClip) {
      const span = Math.max(1, activeClip.out_frame - activeClip.in_frame);
      const progress = Math.max(0, Math.min(1, (playheadFrame - activeClip.in_frame) / span));
      const fx = timeline.effects.find(
        (e) =>
          e.scene_id === activeClip.scene_id &&
          playheadFrame >= e.in_frame &&
          playheadFrame < e.out_frame,
      );
      const zoom =
        fx?.type === "ken_burns_pull" ? 1.08 - 0.08 * progress : 1.0 + 0.08 * progress;

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2, -h / 2);

      ctx.fillStyle = "rgba(139, 92, 246, 0.14)";
      for (let step = 0; step < 5; step += 1) {
        const inset = 64 + step * 38;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.22)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(inset, 52 + step * 26, w - inset * 2, h - 120 - step * 34);
      }

      const glow = ctx.createRadialGradient(w * 0.36, h * 0.44, 6, w * 0.36, h * 0.44, 150);
      glow.addColorStop(0, "rgba(251, 191, 36, 0.4)");
      glow.addColorStop(1, "rgba(251, 191, 36, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }, [activeClip, playheadFrame, timeline.effects]);

  function applyEdit(next: KrTimelineV1, label: string) {
    setLastActionLabel(label);
    setHistory((h) => commitEditorEdit(h, next));
    setStatusMsg(null);
    if (next.total_frames > 0 && playheadFrame >= next.total_frames) {
      setPlayheadFrame(next.total_frames - 1);
    }
  }

  function handleSplit() {
    if (!activeClip) return;
    if (playheadFrame <= activeClip.in_frame || playheadFrame >= activeClip.out_frame) {
      setStatusMsg("Move playhead inside a clip before splitting.");
      return;
    }
    applyEdit(splitAtFrame(timeline, playheadFrame), `Split @ ${formatTimecode(playheadFrame)}`);
  }

  function handleTrimIn(delta: number) {
    const clip = selectedClip;
    if (!clip) return;
    const next = trimClipInEdge(timeline, clip.clip_id, delta);
    if (next === timeline) {
      setStatusMsg("Reached source start or 12-frame minimum clip duration.");
      return;
    }
    applyEdit(next, `Trim in ${clip.label} (${delta > 0 ? "+" : ""}${delta}f)`);
  }

  function handleTrimOut(delta: number) {
    const clip = selectedClip;
    if (!clip) return;
    const next = trimClipOutEdge(timeline, clip.clip_id, delta);
    if (next === timeline) {
      setStatusMsg("Reached source end or 12-frame minimum clip duration.");
      return;
    }
    applyEdit(next, `Trim out ${clip.label} (${delta > 0 ? "+" : ""}${delta}f)`);
  }

  function handleRippleDeleteSelected() {
    const clip = selectedClip;
    if (!clip || timeline.clips.length <= 1) {
      setStatusMsg("Keep at least one clip on the timeline.");
      return;
    }
    if (sceneById.get(clip.scene_id)?.locked_canon) {
      setStatusMsg(
        "Protected canon range: unlock this scene in the Story tab before ripple-deleting.",
      );
      return;
    }
    const next = rippleDeleteRange(timeline, clip.in_frame, clip.out_frame);
    applyEdit(next, `Ripple delete ${clip.label}`);
    setSelectedClipId(next.clips[0]?.clip_id ?? null);
  }

  function handleApplyMeasuredSilence(suggestion: (typeof timeline.silence_suggestions)[number]) {
    try {
      const next = applyMeasuredSilenceTrim(
        timeline,
        suggestion,
        probeMap,
        latestJob?.checkpoints ?? [],
      );
      applyEdit(
        next,
        `Trim validated silence [${suggestion.in_frame}, ${suggestion.out_frame})`,
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Auto-trim blocked");
    }
  }

  function handleStemChange(
    stemId: KrAudioStem["stem_id"],
    patch: Partial<Pick<KrAudioStem, "gain_db" | "muted" | "solo">>,
  ) {
    applyEdit(updateAudioStem(timeline, stemId, patch), `Mix ${stemId}`);
  }

  async function handleSaveRevision() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await krApiFetch<{ timeline: KrTimelineV1 }>("/api/kr/timeline/edit", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          expected_version: workspace.timeline.version,
          action_label: lastActionLabel,
          timeline,
        }),
      });
      setHistory(createEditorHistory(res.timeline));
      setStatusMsg(`Saved Timeline v${res.timeline.version}`);
      await onRefresh();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function scrubAtClientX(clientX: number) {
    const container = timelineScrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const frame = frameFromTrackClientX({
      clientX,
      trackViewportLeft: rect.left,
      scrollLeft: container.scrollLeft,
      pxPerFrame,
      totalFrames: timeline.total_frames,
      leadingPaddingPx: TIMELINE_LEADING_PAD_PX,
    });
    setPlaying(false);
    setPlayheadFrame(frame);
  }

  const timelineContentWidth = Math.max(
    320,
    Math.round(timeline.total_frames * pxPerFrame + TIMELINE_LEADING_PAD_PX * 2 + 24),
  );
  const playheadLeftPx = TIMELINE_LEADING_PAD_PX + playheadFrame * pxPerFrame;
  const tickStepFrames = pxPerFrame >= 2 ? 24 : 48;

  const captionMode = timeline.active_caption_lang;
  const showHiCaption = Boolean(
    activeCaption && (captionMode === "hi" || captionMode === "both"),
  );
  const showEnCaption = Boolean(
    activeCaption && (captionMode === "en" || captionMode === "both"),
  );

  const pictureState = activeClipMedia?.picture.state ?? "pending";
  const pictureBadgeText =
    pictureState === "validated"
      ? "Media Verified"
      : pictureState === "available"
        ? "Asset Available · Unverified"
        : pictureState === "playback_error"
          ? "Media Load Error · Storyboard Fallback"
          : "Storyboard Only · Media Pending Worker";

  return (
    <div className="flex flex-col gap-3">
      {/* Top Save Status + Undo/Redo Bar */}
      <section className="kr-card flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            data-testid="save-status-badge"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              dirty
                ? "border-amber-400/35 bg-amber-500/15 text-amber-200"
                : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
            }`}
          >
            {dirty ? (
              <>Unsaved edits · draft v{timeline.version}</>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved v{workspace.timeline.version}
              </>
            )}
          </span>
          {activeSceneMeta?.locked_canon && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-200">
              <Lock className="h-3 w-3" /> Canon Locked
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Undo"
            disabled={history.past.length === 0}
            onClick={() => setHistory((h) => undoEditorHistory(h))}
            className="kr-tap inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Undo</span>
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={history.future.length === 0}
            onClick={() => setHistory((h) => redoEditorHistory(h))}
            className="kr-tap inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Redo</span>
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={handleSaveRevision}
            className="kr-tap inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </section>

      {/* 16:9 Preview Player with Readable CSS Captions & Honest Storyboard State */}
      <section className="kr-card rounded-2xl p-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
          {activeClipMedia?.picture.kind === "video" &&
          activeClipMedia.picture.url &&
          pictureState !== "playback_error" ? (
            <video
              ref={videoRef}
              src={activeClipMedia.picture.url}
              playsInline
              muted
              onLoadedData={() => {
                const u = activeClipMedia.picture.url;
                if (u) setProbeMap((prev) => ({ ...prev, [u]: "validated" }));
              }}
              onError={() => {
                const u = activeClipMedia.picture.url;
                if (u) setProbeMap((prev) => ({ ...prev, [u]: "playback_error" }));
              }}
              className="h-full w-full object-cover"
            />
          ) : activeClipMedia?.picture.kind === "image" &&
            activeClipMedia.picture.url &&
            pictureState !== "playback_error" ? (
            <img
              src={activeClipMedia.picture.url}
              alt={activeClip?.label ?? "Scene plate"}
              onLoad={() => {
                const u = activeClipMedia.picture.url;
                if (u) setProbeMap((prev) => ({ ...prev, [u]: "validated" }));
              }}
              onError={() => {
                const u = activeClipMedia.picture.url;
                if (u) setProbeMap((prev) => ({ ...prev, [u]: "playback_error" }));
              }}
              className="h-full w-full object-cover"
            />
          ) : (
            <canvas
              ref={canvasRef}
              width={672}
              height={378}
              className="h-full w-full object-cover"
            />
          )}

          {/* Top Preview Badges */}
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex flex-wrap items-center justify-between gap-1.5">
            <span
              data-testid="preview-media-badge"
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${STATE_BADGE_CLASS[pictureState]}`}
            >
              {activeClip?.label ? `${activeClip.label} · ` : ""}
              {pictureBadgeText}
            </span>

            <span className="rounded-full border border-white/15 bg-black/70 px-2.5 py-1 text-[10px] font-medium text-slate-200 backdrop-blur-sm">
              {activeAudioPlayback.badgeText}
            </span>
          </div>

          {/* Crisp, Untruncated HTML/CSS Bilingual Captions Overlay */}
          {(showHiCaption || showEnCaption) && activeCaption && (
            <div
              data-testid="preview-caption-overlay"
              className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex justify-center"
            >
              <div className="max-w-full rounded-xl border border-white/10 bg-black/82 px-3 py-2 text-center shadow-lg backdrop-blur-sm">
                {showHiCaption && (
                  <p className="text-sm font-semibold leading-snug text-white sm:text-base">
                    {activeCaption.hi_text}
                  </p>
                )}
                {showEnCaption && (
                  <p className="mt-0.5 text-xs font-medium leading-snug text-slate-200 sm:text-sm">
                    {activeCaption.en_text}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Real Audio Element (only wired when an actual audio URL exists) */}
          <audio
            ref={audioRef}
            src={activeAudioDetail?.url ?? undefined}
            preload="metadata"
            onLoadedMetadata={() => {
              const u = activeAudioDetail?.url;
              if (u) {
                setAudioPlaybackNotice(null);
                setProbeMap((prev) => ({ ...prev, [u]: "validated" }));
              }
            }}
            onCanPlay={() => {
              const u = activeAudioDetail?.url;
              if (u) {
                setAudioPlaybackNotice(null);
                setProbeMap((prev) => ({ ...prev, [u]: "validated" }));
              }
            }}
            onError={() => {
              const u = activeAudioDetail?.url;
              if (u) {
                setProbeMap((prev) => ({ ...prev, [u]: "playback_error" }));
                setAudioPlaybackNotice("Audio stream failed to decode — using silent storyboard.");
              }
            }}
          />
        </div>

        {/* Transport & Audio Status Strip */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="kr-tap inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? "Pause" : "Play"}
            </button>
            <span className="font-mono text-xs text-slate-200">
              {formatTimecode(playheadFrame)} / {formatTimecode(timeline.total_frames)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {(["hi", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() =>
                  applyEdit(
                    { ...timeline, active_audio_lang: lang, version: timeline.version + 1 },
                    `Audio ${lang.toUpperCase()}`,
                  )
                }
                className={`kr-tap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  timeline.active_audio_lang === lang
                    ? "bg-violet-600 text-white"
                    : "bg-white/5 text-[var(--kr-muted)]"
                }`}
              >
                {lang.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setToolPanel("captions")}
              className="kr-tap inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              <Eye className="h-3.5 w-3.5 text-violet-300" />
              Full Text
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-[11px] text-[var(--kr-muted)]">
          {audioPlaybackNotice ?? activeAudioPlayback.detailText}
        </p>

        {/* Compact Full-Text Preview Bar (never truncated) */}
        {activeCaption && (
          <div
            data-testid="full-caption-bar"
            className="mt-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-violet-300">
              <span>Current Playhead Script</span>
              <span>
                [{activeCaption.in_frame}, {activeCaption.out_frame})
              </span>
            </div>
            <p className="mt-1 font-medium text-white">{activeCaption.hi_text}</p>
            <p className="mt-0.5 text-slate-300">{activeCaption.en_text}</p>
          </div>
        )}
      </section>

      {/* CapCut / InShot-Style Horizontal Scrubbable & Zoomable Timeline */}
      <section className="kr-card rounded-2xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
              Timeline ({timeline.clips.length} clips · 24fps)
            </h3>
            {trimDragPreview && (
              <p className="text-[11px] font-semibold text-violet-300">
                Trimming {trimDragPreview.edge.toUpperCase()} edge:{" "}
                {trimDragPreview.deltaFrames > 0
                  ? `+${trimDragPreview.deltaFrames}f`
                  : `${trimDragPreview.deltaFrames}f`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Zoom out timeline"
              onClick={() => setPxPerFrame((z) => clampZoomPxPerFrame(z - 0.5))}
              className="kr-tap grid place-items-center rounded-lg border border-white/10 bg-white/5 px-2 text-slate-200 hover:bg-white/10"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[44px] text-center font-mono text-[11px] text-slate-300">
              {pxPerFrame.toFixed(1)}x
            </span>
            <button
              type="button"
              aria-label="Zoom in timeline"
              onClick={() => setPxPerFrame((z) => clampZoomPxPerFrame(z + 0.5))}
              className="kr-tap grid place-items-center rounded-lg border border-white/10 bg-white/5 px-2 text-slate-200 hover:bg-white/10"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Horizontally Scrollable Track Viewport */}
        <div
          ref={timelineScrollRef}
          data-testid="timeline-scroll-viewport"
          className="relative mt-2.5 overflow-x-auto rounded-xl border border-white/10 bg-[#0b0f18] pb-3"
          style={{ touchAction: "pan-x" }}
        >
          <div
            className="relative select-none"
            style={{ width: `${timelineContentWidth}px`, minHeight: "178px" }}
          >
            {/* Playhead Needle across all tracks */}
            <div
              data-testid="timeline-playhead"
              className="pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]"
              style={{ left: `${playheadLeftPx}px` }}
            >
              <div className="-ml-[6px] h-3.5 w-3.5 rotate-45 rounded-xs bg-violet-400" />
            </div>

            {/* Time Ruler (tap or drag to scrub playhead) */}
            <div
              data-testid="timeline-ruler"
              role="slider"
              aria-label="Timeline scrub ruler"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, timeline.total_frames - 1)}
              aria-valuenow={playheadFrame}
              tabIndex={0}
              onPointerDown={(e) => {
                scrubActiveRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubAtClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                if (!scrubActiveRef.current) return;
                scrubAtClientX(e.clientX);
              }}
              onPointerUp={(e) => {
                scrubActiveRef.current = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerCancel={() => {
                scrubActiveRef.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setPlayheadFrame((f) => Math.max(0, f - 12));
                if (e.key === "ArrowRight")
                  setPlayheadFrame((f) =>
                    Math.min(Math.max(0, timeline.total_frames - 1), f + 12),
                  );
              }}
              className="relative h-8 cursor-ew-resize border-b border-white/10 bg-white/[0.03]"
              style={{ touchAction: "none" }}
            >
              {Array.from(
                { length: Math.floor(timeline.total_frames / tickStepFrames) + 1 },
                (_, i) => i * tickStepFrames,
              ).map((frameTick) => (
                <div
                  key={frameTick}
                  className="absolute bottom-0 flex flex-col items-start border-l border-white/20 pl-1 text-[10px] font-mono text-slate-400"
                  style={{ left: `${TIMELINE_LEADING_PAD_PX + frameTick * pxPerFrame}px` }}
                >
                  <span>{Math.round(frameTick / KR_FPS)}s</span>
                </div>
              ))}
            </div>

            {/* Track 1: Video / Storyboard Clips with Left & Right Drag Trim Handles */}
            <div className="relative mt-2 h-16">
              {timeline.clips.map((clip) => {
                const isSel = clip.clip_id === selectedClip?.clip_id;
                const durFrames = clip.out_frame - clip.in_frame;
                const leftPx = TIMELINE_LEADING_PAD_PX + clip.in_frame * pxPerFrame;
                const widthPx = Math.max(40, durFrames * pxPerFrame);
                const clipMedia = allClipMediaMap.get(clip.clip_id);
                const isLocked = Boolean(sceneById.get(clip.scene_id)?.locked_canon);

                return (
                  <div
                    key={clip.clip_id}
                    data-testid={`timeline-clip-${clip.clip_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedClipId(clip.clip_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedClipId(clip.clip_id);
                    }}
                    className={`absolute top-0 flex h-14 items-center overflow-hidden rounded-xl border transition ${
                      isSel
                        ? "z-10 border-violet-400 bg-violet-600/25 ring-2 ring-violet-400/50"
                        : "border-white/15 bg-slate-800/80 hover:border-white/30"
                    }`}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  >
                    {/* Left Trim Handle */}
                    {isSel && (
                      <div
                        data-testid={`trim-handle-in-${clip.clip_id}`}
                        role="separator"
                        aria-label={`Trim start of ${clip.label}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          trimGestureRef.current = {
                            clipId: clip.clip_id,
                            edge: "in",
                            startClientX: e.clientX,
                            pointerId: e.pointerId,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setTrimDragPreview({ clipId: clip.clip_id, edge: "in", deltaFrames: 0 });
                        }}
                        onPointerMove={(e) => {
                          const g = trimGestureRef.current;
                          if (!g || g.clipId !== clip.clip_id || g.edge !== "in") return;
                          e.stopPropagation();
                          const delta = computeTrimDeltaFrames({
                            startClientX: g.startClientX,
                            currentClientX: e.clientX,
                            pxPerFrame,
                          });
                          setTrimDragPreview({ clipId: clip.clip_id, edge: "in", deltaFrames: delta });
                        }}
                        onPointerUp={(e) => {
                          const g = trimGestureRef.current;
                          if (!g || g.clipId !== clip.clip_id || g.edge !== "in") return;
                          e.stopPropagation();
                          const delta = computeTrimDeltaFrames({
                            startClientX: g.startClientX,
                            currentClientX: e.clientX,
                            pxPerFrame,
                          });
                          trimGestureRef.current = null;
                          setTrimDragPreview(null);
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                          if (delta !== 0) handleTrimIn(delta);
                        }}
                        onPointerCancel={() => {
                          trimGestureRef.current = null;
                          setTrimDragPreview(null);
                        }}
                        className="flex h-full w-5 shrink-0 cursor-ew-resize items-center justify-center bg-violet-400 text-slate-950"
                        style={{ touchAction: "none" }}
                      >
                        <span className="h-5 w-0.5 rounded-full bg-slate-950" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 px-2 py-1">
                      <div className="flex items-center gap-1 truncate text-[11px] font-semibold text-white">
                        {isLocked && <Lock className="h-3 w-3 shrink-0 text-violet-300" />}
                        <span className="truncate">{clip.label}</span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-300">
                        {durFrames}f · {clipMedia?.picture.state ?? "pending"}
                      </div>
                    </div>

                    {/* Right Trim Handle */}
                    {isSel && (
                      <div
                        data-testid={`trim-handle-out-${clip.clip_id}`}
                        role="separator"
                        aria-label={`Trim end of ${clip.label}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          trimGestureRef.current = {
                            clipId: clip.clip_id,
                            edge: "out",
                            startClientX: e.clientX,
                            pointerId: e.pointerId,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setTrimDragPreview({ clipId: clip.clip_id, edge: "out", deltaFrames: 0 });
                        }}
                        onPointerMove={(e) => {
                          const g = trimGestureRef.current;
                          if (!g || g.clipId !== clip.clip_id || g.edge !== "out") return;
                          e.stopPropagation();
                          const delta = computeTrimDeltaFrames({
                            startClientX: g.startClientX,
                            currentClientX: e.clientX,
                            pxPerFrame,
                          });
                          setTrimDragPreview({ clipId: clip.clip_id, edge: "out", deltaFrames: delta });
                        }}
                        onPointerUp={(e) => {
                          const g = trimGestureRef.current;
                          if (!g || g.clipId !== clip.clip_id || g.edge !== "out") return;
                          e.stopPropagation();
                          const delta = computeTrimDeltaFrames({
                            startClientX: g.startClientX,
                            currentClientX: e.clientX,
                            pxPerFrame,
                          });
                          trimGestureRef.current = null;
                          setTrimDragPreview(null);
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                          if (delta !== 0) handleTrimOut(delta);
                        }}
                        onPointerCancel={() => {
                          trimGestureRef.current = null;
                          setTrimDragPreview(null);
                        }}
                        className="flex h-full w-5 shrink-0 cursor-ew-resize items-center justify-center bg-violet-400 text-slate-950"
                        style={{ touchAction: "none" }}
                      >
                        <span className="h-5 w-0.5 rounded-full bg-slate-950" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Track 2: Bilingual Audio Lane (Hides synthetic waveforms in Production Mode!) */}
            <div className="relative mt-1 h-11">
              {timeline.clips.map((clip) => {
                const durFrames = clip.out_frame - clip.in_frame;
                const leftPx = TIMELINE_LEADING_PAD_PX + clip.in_frame * pxPerFrame;
                const widthPx = Math.max(40, durFrames * pxPerFrame);
                const clipMedia = allClipMediaMap.get(clip.clip_id);
                const langAudio =
                  timeline.active_audio_lang === "hi"
                    ? clipMedia?.hiAudio
                    : clipMedia?.enAudio;
                const audioValidated = langAudio?.state === "validated";
                const waveform =
                  timeline.active_audio_lang === "hi" ? clip.waveform_hi : clip.waveform_en;

                return (
                  <div
                    key={`aud_${clip.clip_id}`}
                    className={`absolute top-0 flex h-10 flex-col justify-center overflow-hidden rounded-lg border px-2 ${
                      audioValidated
                        ? "border-sky-400/40 bg-sky-500/15"
                        : demoPreviewMode
                          ? "border-amber-400/35 bg-amber-500/10"
                          : "border-white/10 bg-white/[0.03]"
                    }`}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  >
                    {audioValidated ? (
                      <div className="flex h-6 items-end gap-[2px]">
                        {waveform.slice(0, 32).map((amp, i) => (
                          <span
                            key={i}
                            className="flex-1 rounded-t bg-sky-400/80"
                            style={{ height: `${Math.max(15, Math.round(amp * 100))}%` }}
                          />
                        ))}
                      </div>
                    ) : demoPreviewMode ? (
                      <div className="flex h-6 items-end gap-[2px]" title="Demo synthetic preview">
                        {waveform.slice(0, 24).map((amp, i) => (
                          <span
                            key={i}
                            className="flex-1 rounded-t bg-amber-300/50"
                            style={{ height: `${Math.max(15, Math.round(amp * 100))}%` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="truncate text-[10px] text-slate-400">
                        {timeline.active_audio_lang.toUpperCase()} Audio: {langAudio?.state ?? "pending"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Track 3: Captions Lane */}
            <div className="relative mt-1 h-8">
              {timeline.captions.map((cap) => {
                const durFrames = cap.out_frame - cap.in_frame;
                const leftPx = TIMELINE_LEADING_PAD_PX + cap.in_frame * pxPerFrame;
                const widthPx = Math.max(40, durFrames * pxPerFrame);
                const previewText =
                  timeline.active_caption_lang === "en" ? cap.en_text : cap.hi_text;
                return (
                  <div
                    key={cap.caption_id}
                    className="absolute top-0 flex h-7 items-center overflow-hidden rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 text-[10px] text-emerald-100"
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  >
                    <span className="truncate">{previewText}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom Contextual Tool Switcher (CapCut / InShot style) */}
      <section className="kr-card rounded-2xl p-3">
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-black/35 p-1">
          {(
            [
              { id: "edit", label: "Edit", icon: Scissors },
              { id: "audio", label: "Audio & Mix", icon: SlidersHorizontal },
              { id: "captions", label: "Captions", icon: Subtitles },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setToolPanel(id)}
              className={`kr-tap flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                toolPanel === id
                  ? "bg-violet-600 text-white"
                  : "text-[var(--kr-muted)] hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {statusMsg && (
          <p className="mt-2.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
            {statusMsg}
          </p>
        )}

        {/* PANEL 1: Edit Tools */}
        {toolPanel === "edit" && (
          <div className="mt-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[var(--kr-muted)]">
                Selected:{" "}
                <strong className="text-white">{selectedClip?.label ?? "None"}</strong>
                {selectedSceneMeta?.locked_canon ? " (Canon Locked)" : ""}
              </span>
              {selectedClip && (
                <span className="font-mono text-[11px] text-slate-300">
                  [{selectedClip.in_frame}, {selectedClip.out_frame}) ·{" "}
                  {selectedClip.out_frame - selectedClip.in_frame}f
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={handleSplit}
                className="kr-tap inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                <Scissors className="h-3.5 w-3.5 text-violet-300" /> Split at Playhead
              </button>
              <button
                type="button"
                onClick={() => handleTrimIn(12)}
                className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                In +12f
              </button>
              <button
                type="button"
                onClick={() => handleTrimIn(-12)}
                className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                In -12f
              </button>
              <button
                type="button"
                onClick={() => handleTrimOut(-12)}
                className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                Out -12f
              </button>
              <button
                type="button"
                onClick={() => handleTrimOut(12)}
                className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                Out +12f
              </button>
              <button
                type="button"
                onClick={handleRippleDeleteSelected}
                className="kr-tap inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" /> Ripple Delete
              </button>
            </div>
          </div>
        )}

        {/* PANEL 2: Honest Audio, Demo Gate & 5-Stem Mix */}
        {toolPanel === "audio" && (
          <div className="mt-3 space-y-3">
            {/* Production vs Demo Preview Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/35 p-3 text-xs">
              <div>
                <div className="font-semibold text-white">
                  Audio State: {activeAudioPlayback.badgeText}
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--kr-muted)]">
                  {hasAnyValidatedAudio
                    ? "Validated audio tracks available for playback."
                    : "Actual worker audio is absent. Synthetic waveforms & silence trims stay hidden/disabled in production mode."}
                </p>
              </div>

              {!hasAnyValidatedAudio && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={demoPreviewMode}
                  onClick={() => setDemoPreviewMode((v) => !v)}
                  className={`kr-tap rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    demoPreviewMode
                      ? "border-amber-400/50 bg-amber-500/20 text-amber-200"
                      : "border-white/15 bg-white/5 text-slate-200"
                  }`}
                >
                  Demo Preview: {demoPreviewMode ? "ON (Read-Only)" : "OFF"}
                </button>
              )}
            </div>

            {demoPreviewMode && !hasAnyValidatedAudio && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <strong>DEMO MODE ACTIVE:</strong> Synthetic waveform bars and dB values below
                  are seeded placeholders, not real audio analysis. Real timeline auto-trim from demo
                  silence is strictly disabled.
                </div>
              </div>
            )}

            {/* Silence Suggestions (Hidden unless validated audio OR read-only demo mode) */}
            {hasAnyValidatedAudio ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
                  Measured Bilingual Silence Candidates
                </h4>
                {timeline.silence_suggestions.length === 0 ? (
                  <p className="text-xs text-[var(--kr-muted)]">
                    No simultaneous HI+EN silence spans detected.
                  </p>
                ) : (
                  timeline.silence_suggestions.map((s) => {
                    const allowed = canAutoTrimSilenceSuggestion(
                      timeline,
                      s,
                      probeMap,
                      latestJob?.checkpoints ?? [],
                    );
                    return (
                      <div
                        key={s.suggestion_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs"
                      >
                        <div>
                          <span className="font-mono text-violet-300">
                            [{s.in_frame}, {s.out_frame})
                          </span>{" "}
                          <span className="text-[var(--kr-muted)]">
                            · HI {s.hi_peak_db}dB / EN {s.en_peak_db}dB
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={!allowed}
                          onClick={() => handleApplyMeasuredSilence(s)}
                          className="kr-tap rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
                        >
                          {allowed ? "Ripple Trim Pause" : "Requires Validated HI+EN"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : demoPreviewMode ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                  Demo Silence Estimates (Read-Only · Auto-Trim Disabled)
                </h4>
                {timeline.silence_suggestions.map((s) => (
                  <div
                    key={s.suggestion_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-black/30 p-3 text-xs"
                  >
                    <div>
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                        DEMO
                      </span>{" "}
                      <span className="font-mono text-slate-200">
                        [{s.in_frame}, {s.out_frame})
                      </span>{" "}
                      <span className="text-[var(--kr-muted)]">
                        · Est. HI {s.hi_peak_db}dB / EN {s.en_peak_db}dB
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="kr-tap rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-400 opacity-60"
                    >
                      Auto-trim disabled in Demo
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[var(--kr-muted)]">
                Silence detection and auto-trim are hidden until actual HI and EN audio assets are
                rendered and verified.
              </div>
            )}

            {/* 5-Stem Pre-Mix / Gain Controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <h4 className="font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
                  5-Stem Gain (48 kHz)
                </h4>
                <span className="text-[11px] text-[var(--kr-muted)]">
                  {hasAnyValidatedAudio ? "Live voice gain active" : "Pre-mix settings for worker compose"}
                </span>
              </div>
              {timeline.stems.map((stem) => (
                <div
                  key={stem.stem_id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-2.5"
                >
                  <div className="w-28 text-xs font-medium text-white">{stem.label}</div>
                  <input
                    type="range"
                    min={-48}
                    max={12}
                    step={1}
                    value={stem.gain_db}
                    aria-label={`${stem.label} gain`}
                    onChange={(e) =>
                      handleStemChange(stem.stem_id, { gain_db: Number(e.target.value) })
                    }
                    className="min-w-[110px] flex-1 accent-violet-500"
                  />
                  <span className="w-12 text-right font-mono text-xs text-slate-300">
                    {stem.gain_db > 0 ? `+${stem.gain_db}` : stem.gain_db}dB
                  </span>
                  <button
                    type="button"
                    aria-label={`Mute ${stem.label}`}
                    onClick={() => handleStemChange(stem.stem_id, { muted: !stem.muted })}
                    className={`kr-tap rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      stem.muted
                        ? "bg-rose-500/20 text-rose-200"
                        : "bg-white/5 text-slate-200"
                    }`}
                  >
                    {stem.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PANEL 3: Captions Mode & Full Untruncated Script Inspector */}
        {toolPanel === "captions" && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
                Preview Caption Display
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "both", label: "HI + EN" },
                    { id: "hi", label: "HI Only" },
                    { id: "en", label: "EN Only" },
                    { id: "off", label: "Off" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      applyEdit(
                        {
                          ...timeline,
                          active_caption_lang: opt.id,
                          version: timeline.version + 1,
                        },
                        `Caption mode: ${opt.label}`,
                      )
                    }
                    className={`kr-tap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                      timeline.active_caption_lang === opt.id
                        ? "bg-violet-600 text-white"
                        : "bg-white/5 text-[var(--kr-muted)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              data-testid="full-text-inspector"
              className="rounded-xl border border-white/10 bg-black/35 p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  {activeSceneMeta?.title ?? activeClip?.label ?? "Active Scene"}
                </span>
                <span className="font-mono text-[11px] text-violet-300">
                  {activeClip
                    ? `[${activeClip.in_frame}, ${activeClip.out_frame}) · ${(
                        (activeClip.out_frame - activeClip.in_frame) /
                        KR_FPS
                      ).toFixed(2)}s`
                    : ""}
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                    Hindi (Full Narration)
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-white">
                    {activeCaption?.hi_text ?? activeSceneMeta?.hi_narration ?? "—"}
                  </p>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    English (Full Narration)
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-200">
                    {activeCaption?.en_text ?? activeSceneMeta?.en_narration ?? "—"}
                  </p>
                </div>
                {activeSceneMeta && (
                  <p className="border-t border-white/10 pt-2 text-[11px] text-[var(--kr-muted)]">
                    <strong className="text-slate-300">Scene Plate Prompt:</strong>{" "}
                    {activeSceneMeta.visual_prompt}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
