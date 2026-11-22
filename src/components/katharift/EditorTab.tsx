import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { KrAudioStem, KrTimelineV1 } from "@/packages/contracts/schemas";
import { KR_FPS, formatTimecode } from "@/packages/contracts/timing";
import {
  commitEditorEdit,
  createEditorHistory,
  redoEditorHistory,
  rippleDeleteRange,
  splitAtFrame,
  trimClipOutEdge,
  undoEditorHistory,
  updateAudioStem,
  type EditorHistoryStack,
} from "@/packages/editor/engine";
import { krApiFetch, type WorkspaceSnapshot } from "./types";

interface EditorTabProps {
  workspace: WorkspaceSnapshot;
  onRefresh: () => Promise<void>;
}

export function EditorTab({ workspace, onRefresh }: EditorTabProps) {
  const [history, setHistory] = useState<EditorHistoryStack>(() =>
    createEditorHistory(workspace.timeline),
  );
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    workspace.timeline.clips[0]?.clip_id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [lastActionLabel, setLastActionLabel] = useState("Timeline edit");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const timeline = history.present;
  const dirty = timeline.version !== workspace.timeline.version;

  // Sync incoming server timeline if clean
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

  const activeCaption = useMemo(
    () =>
      timeline.captions.find(
        (c) => playheadFrame >= c.in_frame && playheadFrame < c.out_frame,
      ) ?? null,
    [timeline.captions, playheadFrame],
  );

  const activeSceneMeta = useMemo(
    () =>
      workspace.storyRevision.bible.scenes.find(
        (s) => s.scene_id === activeClip?.scene_id,
      ) ?? null,
    [workspace.storyRevision.bible.scenes, activeClip],
  );

  // 24fps playback loop
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

  // Draw deterministic 16:9 anime preview plate + Ken Burns + captions on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Restrained twilight gradient backdrop (illustrative storyboard plate preview)
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
        (e) => e.scene_id === activeClip.scene_id && playheadFrame >= e.in_frame && playheadFrame < e.out_frame,
      );
      const zoom =
        fx?.type === "ken_burns_pull"
          ? 1.08 - 0.08 * progress
          : 1.0 + 0.08 * progress;

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2, -h / 2);

      // Architectural stepwell geometric silhouette + warm lantern key light
      ctx.fillStyle = "rgba(139, 92, 246, 0.16)";
      for (let step = 0; step < 5; step += 1) {
        const inset = 60 + step * 38;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.24)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(inset, 56 + step * 28, w - inset * 2, h - 130 - step * 36);
      }

      const glow = ctx.createRadialGradient(w * 0.36, h * 0.44, 6, w * 0.36, h * 0.44, 150);
      glow.addColorStop(0, "rgba(251, 191, 36, 0.45)");
      glow.addColorStop(1, "rgba(251, 191, 36, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Top metadata badge
      ctx.fillStyle = "rgba(11, 14, 20, 0.72)";
      ctx.fillRect(14, 14, 290, 32);
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "600 13px Inter, sans-serif";
      ctx.fillText(
        `${activeClip.label} · ${activeClip.drive_image_id ? "Plate Ready" : "Storyboard Preview"}`,
        24,
        35,
      );
    }

    // Live selectable captions
    if (activeCaption && timeline.active_caption_lang !== "off") {
      const showHi =
        timeline.active_caption_lang === "hi" || timeline.active_caption_lang === "both";
      const showEn =
        timeline.active_caption_lang === "en" || timeline.active_caption_lang === "both";
      const lines: string[] = [];
      if (showHi) lines.push(activeCaption.hi_text);
      if (showEn) lines.push(activeCaption.en_text);

      if (lines.length > 0) {
        const boxH = lines.length * 24 + 18;
        ctx.fillStyle = "rgba(11, 14, 20, 0.82)";
        ctx.fillRect(24, h - boxH - 16, w - 48, boxH);
        ctx.fillStyle = "#F8FAFC";
        ctx.textAlign = "center";
        lines.forEach((line, idx) => {
          ctx.font =
            idx === 0 && showHi
              ? '600 14px "Noto Sans Devanagari", Inter, sans-serif'
              : "500 13px Inter, sans-serif";
          ctx.fillText(line.slice(0, 74), w / 2, h - boxH + 6 + idx * 24);
        });
        ctx.textAlign = "left";
      }
    }
  }, [activeClip, activeCaption, activeSceneMeta, playheadFrame, timeline.active_caption_lang, timeline.effects]);

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
      setStatusMsg("Scrub playhead inside a clip before splitting.");
      return;
    }
    applyEdit(splitAtFrame(timeline, playheadFrame), `Split @ ${formatTimecode(playheadFrame)}`);
  }

  function handleTrimOut(delta: number) {
    const clip = timeline.clips.find((c) => c.clip_id === selectedClipId) ?? activeClip;
    if (!clip) return;
    applyEdit(trimClipOutEdge(timeline, clip.clip_id, delta), `Trim ${clip.label} (${delta > 0 ? "+" : ""}${delta}f)`);
  }

  function handleRippleDeleteSelected() {
    const clip = timeline.clips.find((c) => c.clip_id === selectedClipId) ?? activeClip;
    if (!clip || timeline.clips.length <= 1) {
      setStatusMsg("Keep at least one clip on the timeline.");
      return;
    }
    const next = rippleDeleteRange(timeline, clip.in_frame, clip.out_frame);
    applyEdit(next, `Ripple delete ${clip.label}`);
    setSelectedClipId(next.clips[0]?.clip_id ?? null);
  }

  function handleApplySilence(inFrame: number, outFrame: number) {
    const next = rippleDeleteRange(timeline, inFrame, outFrame);
    applyEdit(next, `Trim bilingual silence [${inFrame}, ${outFrame})`);
  }

  function handleStemChange(stemId: KrAudioStem["stem_id"], patch: Partial<Pick<KrAudioStem, "gain_db" | "muted" | "solo">>) {
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

  return (
    <div className="flex flex-col gap-4">
      {/* 16:9 Preview Canvas + Transport + Language Switcher */}
      <section className="kr-card rounded-2xl p-3 sm:p-4">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
          <canvas
            ref={canvasRef}
            width={672}
            height={378}
            className="aspect-video w-full object-cover"
          />
        </div>

        {/* Transport & Scrubber */}
        <div className="mt-3 flex flex-col gap-2.5">
          <input
            type="range"
            min={0}
            max={Math.max(0, timeline.total_frames - 1)}
            value={playheadFrame}
            onChange={(e) => {
              setPlaying(false);
              setPlayheadFrame(Number(e.target.value));
            }}
            aria-label="Timeline playhead frame"
            className="h-6 w-full accent-violet-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
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

            <div className="flex flex-wrap items-center gap-1.5">
              {/* HI / EN Audio Track Switch */}
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
                  {lang.toUpperCase()} Audio
                </button>
              ))}

              {/* Captions Switch */}
              <select
                aria-label="Caption Language"
                value={timeline.active_caption_lang}
                onChange={(e) =>
                  applyEdit(
                    {
                      ...timeline,
                      active_caption_lang: e.target.value as KrTimelineV1["active_caption_lang"],
                      version: timeline.version + 1,
                    },
                    "Caption mode",
                  )
                }
                className="kr-input kr-tap rounded-lg px-2.5 py-1.5 text-xs"
              >
                <option value="both">Captions: HI+EN</option>
                <option value="hi">Captions: HI</option>
                <option value="en">Captions: EN</option>
                <option value="off">Captions: Off</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Non-Destructive Edit Toolbar */}
      <section className="kr-card rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSplit}
            className="kr-tap inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
          >
            <Scissors className="h-3.5 w-3.5 text-violet-300" /> Split
          </button>
          <button
            type="button"
            onClick={() => handleTrimOut(-12)}
            className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
          >
            Trim -12f
          </button>
          <button
            type="button"
            onClick={() => handleTrimOut(12)}
            className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
          >
            Trim +12f
          </button>
          <button
            type="button"
            onClick={handleRippleDeleteSelected}
            className="kr-tap inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Ripple Delete
          </button>
          <button
            type="button"
            disabled={history.past.length === 0}
            onClick={() => setHistory((h) => undoEditorHistory(h))}
            className="kr-tap inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button"
            disabled={history.future.length === 0}
            onClick={() => setHistory((h) => redoEditorHistory(h))}
            className="kr-tap inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" /> Redo
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={handleSaveRevision}
            className="kr-tap ml-auto inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : dirty ? "Save Revision" : `Saved v${workspace.timeline.version}`}
          </button>
        </div>
        {statusMsg && <p className="mt-2 text-xs text-violet-200">{statusMsg}</p>}
      </section>

      {/* Clips & Bilingual Waveform Lanes */}
      <section className="kr-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
          Picture Track & Dual HI/EN Waveforms ({timeline.clips.length} clips)
        </h3>
        <div className="mt-3 flex flex-col gap-2.5">
          {timeline.clips.map((clip) => {
            const isSel = clip.clip_id === (selectedClipId ?? activeClip?.clip_id);
            return (
              <div
                key={clip.clip_id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedClipId(clip.clip_id);
                  setPlayheadFrame(clip.in_frame);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedClipId(clip.clip_id);
                    setPlayheadFrame(clip.in_frame);
                  }
                }}
                className={`rounded-xl border p-3 transition ${
                  isSel
                    ? "border-violet-400/60 bg-violet-500/10"
                    : "border-white/10 bg-black/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-white">{clip.label}</span>
                  <span className="font-mono text-[var(--kr-muted)]">
                    [{clip.in_frame}, {clip.out_frame}) · {clip.out_frame - clip.in_frame}f
                  </span>
                </div>
                {/* Dual Waveform Strips */}
                <div className="mt-2 space-y-1">
                  <div className="flex h-4 items-end gap-[2px]" title="Hindi dry voice envelope">
                    {clip.waveform_hi.slice(0, 32).map((amp, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-t bg-violet-400/75"
                        style={{ height: `${Math.max(15, Math.round(amp * 100))}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex h-4 items-end gap-[2px]" title="English dry voice envelope">
                    {clip.waveform_en.slice(0, 32).map((amp, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-t bg-sky-400/70"
                        style={{ height: `${Math.max(15, Math.round(amp * 100))}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bilingual Silence Suggestions */}
      <section className="kr-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
          Bilingual Silence Suggestions (Both HI & EN Quiet)
        </h3>
        {timeline.silence_suggestions.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--kr-muted)]">
            No simultaneous HI+EN silence spans detected above cut floor.
          </p>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            {timeline.silence_suggestions.map((s) => (
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
                  onClick={() => handleApplySilence(s.in_frame, s.out_frame)}
                  className="kr-tap rounded-lg bg-violet-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
                >
                  Ripple Trim Pause
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5-Stem Mixer */}
      <section className="kr-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
          5-Stem Audio Mixer (48,000 Hz Master)
        </h3>
        <div className="mt-3 flex flex-col gap-2.5">
          {timeline.stems.map((stem) => (
            <div
              key={stem.stem_id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
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
                className="min-w-[120px] flex-1 accent-violet-500"
              />
              <span className="w-12 text-right font-mono text-xs text-slate-300">
                {stem.gain_db > 0 ? `+${stem.gain_db}` : stem.gain_db}dB
              </span>
              <button
                type="button"
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
      </section>
    </div>
  );
}
