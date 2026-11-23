import {
  KR_FPS,
  KR_SAMPLE_RATE,
  allocateCumulativeFrameSpans,
} from "../contracts/timing.ts";
import type {
  KrAudioStem,
  KrCaptionEvent,
  KrCutMarker,
  KrEffectSpan,
  KrKeyframe,
  KrSceneCheckpoint,
  KrSilenceSuggestion,
  KrStoryBible,
  KrTimelineClip,
  KrTimelineV1,
} from "../contracts/schemas.ts";
import { classifyClipMediaStatus, type MediaProbeMap } from "./media-status.ts";

export function deterministicWaveform(seedText: string, bins = 48): number[] {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bins; i += 1) {
    h ^= i + 0x9e3779b9;
    h = Math.imul(h, 2246822519);
    // Keep edges softer (lead-in / lead-out silence) so silence detector finds realistic pauses
    const edge = i < 3 || i >= bins - 3 ? 0.08 : 1;
    const raw = ((h >>> 0) % 1000) / 1000;
    out.push(Number((Math.min(1, Math.max(0.02, raw * edge))).toFixed(3)));
  }
  return out;
}

export function defaultAudioStems(): KrAudioStem[] {
  return [
    { stem_id: "voice_hi", label: "Hindi Voice (HI)", gain_db: 0, muted: false, solo: false },
    { stem_id: "voice_en", label: "English Voice (EN)", gain_db: 0, muted: false, solo: false },
    { stem_id: "music", label: "Score", gain_db: -9, muted: false, solo: false },
    { stem_id: "sfx", label: "SFX", gain_db: -4, muted: false, solo: false },
    { stem_id: "ambience", label: "Ambience", gain_db: -14, muted: false, solo: false },
  ];
}

export function buildTimelineFromStory(params: {
  timeline_id: string;
  project_id: string;
  story_revision_id: string;
  settings_revision_id: string;
  bible: KrStoryBible;
  version?: number;
}): KrTimelineV1 {
  const sampleCounts = params.bible.scenes.map((sc) =>
    Math.round(sc.target_duration_sec * KR_SAMPLE_RATE),
  );
  const spans = allocateCumulativeFrameSpans(sampleCounts, KR_FPS * 2);

  const clips: KrTimelineClip[] = [];
  const captions: KrCaptionEvent[] = [];
  const effects: KrEffectSpan[] = [];
  const keyframes: KrKeyframe[] = [];
  const cuts: KrCutMarker[] = [];

  params.bible.scenes.forEach((scene, idx) => {
    const span = spans[idx];
    const durationFrames = span.outFrame - span.inFrame;
    const effectType: KrEffectSpan["type"] =
      idx % 2 === 0 ? "ken_burns_push" : "ken_burns_pull";

    clips.push({
      clip_id: `clip_${scene.scene_id}`,
      scene_id: scene.scene_id,
      label: scene.title,
      in_frame: span.inFrame,
      out_frame: span.outFrame,
      source_in_frame: 0,
      source_total_frames: durationFrames,
      image_url: null,
      video_url: null,
      drive_image_id: null,
      drive_mp4_id: null,
      hi_audio_url: null,
      en_audio_url: null,
      hi_audio_samples: sampleCounts[idx] ?? durationFrames * 2000,
      en_audio_samples: sampleCounts[idx] ?? durationFrames * 2000,
      waveform_hi: deterministicWaveform(`hi:${scene.scene_id}:${scene.hi_narration}`),
      waveform_en: deterministicWaveform(`en:${scene.scene_id}:${scene.en_narration}`),
    });

    captions.push({
      caption_id: `cap_${scene.scene_id}`,
      scene_id: scene.scene_id,
      in_frame: span.inFrame,
      out_frame: span.outFrame,
      hi_text: scene.hi_narration,
      en_text: scene.en_narration,
    });

    effects.push({
      effect_id: `fx_${scene.scene_id}`,
      scene_id: scene.scene_id,
      type: effectType,
      in_frame: span.inFrame,
      out_frame: span.outFrame,
      intensity: 0.35,
    });

    keyframes.push(
      {
        keyframe_id: `kf_${scene.scene_id}_in`,
        scene_id: scene.scene_id,
        frame: span.inFrame,
        property: "zoom",
        value: effectType === "ken_burns_push" ? 1.0 : 1.08,
        easing: "ease_in_out",
      },
      {
        keyframe_id: `kf_${scene.scene_id}_out`,
        scene_id: scene.scene_id,
        frame: span.outFrame - 1,
        property: "zoom",
        value: effectType === "ken_burns_push" ? 1.08 : 1.0,
        easing: "ease_in_out",
      },
    );

    cuts.push({
      cut_id: `cut_${scene.scene_id}`,
      frame: span.outFrame,
      kind: "scene_boundary",
    });
  });

  const totalFrames = spans.length > 0 ? spans[spans.length - 1].outFrame : 0;

  const base: KrTimelineV1 = {
    schema_version: "kr.timeline.v1",
    timeline_id: params.timeline_id,
    project_id: params.project_id,
    story_revision_id: params.story_revision_id,
    settings_revision_id: params.settings_revision_id,
    version: params.version ?? 1,
    fps: KR_FPS,
    sample_rate: KR_SAMPLE_RATE,
    active_audio_lang: "hi",
    active_caption_lang: "both",
    total_frames: totalFrames,
    clips,
    stems: defaultAudioStems(),
    captions,
    effects,
    keyframes,
    cuts,
    silence_suggestions: [],
    updated_at: new Date().toISOString(),
  };

  return {
    ...base,
    silence_suggestions: detectBilingualSilenceSuggestions(base),
  };
}

/**
 * Inspect BOTH dry Hindi and English waveforms so silence suggestions only
 * propose trimming spans where BOTH languages are silent (never truncating either voice).
 */
export function detectBilingualSilenceSuggestions(
  timeline: KrTimelineV1,
  amplitudeThreshold = 0.14,
  minFrames = 12,
): KrSilenceSuggestion[] {
  const suggestions: KrSilenceSuggestion[] = [];

  for (const clip of timeline.clips) {
    const dur = clip.out_frame - clip.in_frame;
    if (dur < minFrames * 2) continue;
    const bins = Math.min(clip.waveform_hi.length, clip.waveform_en.length);
    if (bins < 4) continue;

    const framesPerBin = dur / bins;
    let runStartBin: number | null = null;

    const flush = (endBin: number) => {
      if (runStartBin === null) return;
      const inFrame = clip.in_frame + Math.round(runStartBin * framesPerBin);
      const outFrame = clip.in_frame + Math.round(endBin * framesPerBin);
      if (outFrame - inFrame >= minFrames) {
        const hiSlice = clip.waveform_hi.slice(runStartBin, endBin);
        const enSlice = clip.waveform_en.slice(runStartBin, endBin);
        const hiPeak = Math.max(0.001, ...hiSlice);
        const enPeak = Math.max(0.001, ...enSlice);
        suggestions.push({
          suggestion_id: `sil_${clip.clip_id}_${inFrame}_${outFrame}`,
          in_frame: inFrame,
          out_frame: outFrame,
          hi_peak_db: Number((20 * Math.log10(hiPeak)).toFixed(1)),
          en_peak_db: Number((20 * Math.log10(enPeak)).toFixed(1)),
          reason: "Both HI & EN dry voices below threshold",
          applied: false,
        });
      }
      runStartBin = null;
    };

    for (let b = 0; b < bins; b += 1) {
      const hiAmp = clip.waveform_hi[b] ?? 1;
      const enAmp = clip.waveform_en[b] ?? 1;
      if (hiAmp <= amplitudeThreshold && enAmp <= amplitudeThreshold) {
        if (runStartBin === null) runStartBin = b;
      } else {
        flush(b);
      }
    }
    flush(bins);
  }
  return suggestions;
}

function recomputeTotalFrames(clips: KrTimelineClip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map((c) => c.out_frame));
}

function shiftFrame(frame: number, deleteIn: number, deleteOut: number): number {
  const removed = deleteOut - deleteIn;
  if (frame <= deleteIn) return frame;
  if (frame >= deleteOut) return frame - removed;
  return deleteIn;
}

/**
 * Ripple-delete [inFrame, outFrame) atomically across clips, captions, effects,
 * keyframes, cuts, and silence suggestions.
 */
export function rippleDeleteRange(
  timeline: KrTimelineV1,
  inFrame: number,
  outFrame: number,
): KrTimelineV1 {
  if (!Number.isInteger(inFrame) || !Number.isInteger(outFrame) || outFrame <= inFrame || inFrame < 0) {
    throw new Error(`Invalid rippleDeleteRange [${inFrame}, ${outFrame})`);
  }
  const removed = outFrame - inFrame;

  const nextClips: KrTimelineClip[] = [];
  for (const clip of timeline.clips) {
    if (clip.out_frame <= inFrame) {
      nextClips.push(clip);
    } else if (clip.in_frame >= outFrame) {
      nextClips.push({
        ...clip,
        in_frame: clip.in_frame - removed,
        out_frame: clip.out_frame - removed,
      });
    } else {
      // Partial overlap: trim tail and/or head
      const beforeDur = Math.max(0, inFrame - clip.in_frame);
      const afterDur = Math.max(0, clip.out_frame - outFrame);
      if (beforeDur > 0 && afterDur > 0) {
        nextClips.push({
          ...clip,
          clip_id: `${clip.clip_id}_a`,
          out_frame: inFrame,
        });
        nextClips.push({
          ...clip,
          clip_id: `${clip.clip_id}_b`,
          in_frame: inFrame,
          out_frame: inFrame + afterDur,
          source_in_frame: clip.source_in_frame + (outFrame - clip.in_frame),
        });
      } else if (beforeDur > 0) {
        nextClips.push({
          ...clip,
          out_frame: inFrame,
        });
      } else if (afterDur > 0) {
        nextClips.push({
          ...clip,
          in_frame: inFrame,
          out_frame: inFrame + afterDur,
          source_in_frame: clip.source_in_frame + (outFrame - clip.in_frame),
        });
      }
      // Fully contained clips are removed cleanly
    }
  }

  const transformSpan = <T extends { in_frame: number; out_frame: number }>(item: T): T | null => {
    if (item.out_frame <= inFrame) return item;
    if (item.in_frame >= outFrame) {
      return {
        ...item,
        in_frame: item.in_frame - removed,
        out_frame: item.out_frame - removed,
      };
    }
    const nextIn = shiftFrame(item.in_frame, inFrame, outFrame);
    const nextOut = shiftFrame(item.out_frame, inFrame, outFrame);
    if (nextOut <= nextIn) return null;
    return { ...item, in_frame: nextIn, out_frame: nextOut };
  };

  const nextCaptions = timeline.captions
    .map(transformSpan)
    .filter((x): x is KrCaptionEvent => x !== null);

  const nextEffects = timeline.effects
    .map(transformSpan)
    .filter((x): x is KrEffectSpan => x !== null);

  const nextKeyframes: KrKeyframe[] = timeline.keyframes
    .filter((kf) => kf.frame < inFrame || kf.frame >= outFrame)
    .map((kf) => ({
      ...kf,
      frame: kf.frame >= outFrame ? kf.frame - removed : kf.frame,
    }));

  const nextCuts: KrCutMarker[] = timeline.cuts
    .filter((c) => c.frame <= inFrame || c.frame >= outFrame)
    .map((c) => ({
      ...c,
      frame: c.frame >= outFrame ? c.frame - removed : c.frame,
    }));

  const nextSuggestions: KrSilenceSuggestion[] = timeline.silence_suggestions
    .filter((s) => !(s.in_frame === inFrame && s.out_frame === outFrame))
    .map((s) => {
      const shifted = transformSpan(s);
      return shifted;
    })
    .filter((s): s is KrSilenceSuggestion => s !== null);

  return {
    ...timeline,
    version: timeline.version + 1,
    total_frames: recomputeTotalFrames(nextClips),
    clips: nextClips,
    captions: nextCaptions,
    effects: nextEffects,
    keyframes: nextKeyframes,
    cuts: nextCuts,
    silence_suggestions: nextSuggestions,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Split clip, captions, and effects at an exact timeline frame.
 */
export function splitAtFrame(timeline: KrTimelineV1, splitFrame: number): KrTimelineV1 {
  const targetClip = timeline.clips.find(
    (c) => splitFrame > c.in_frame && splitFrame < c.out_frame,
  );
  if (!targetClip) {
    throw new Error(`No clip spans splitFrame=${splitFrame}`);
  }

  const nextClips: KrTimelineClip[] = [];
  for (const clip of timeline.clips) {
    if (clip.clip_id !== targetClip.clip_id) {
      nextClips.push(clip);
      continue;
    }
    const leftDur = splitFrame - clip.in_frame;
    const ratio = leftDur / (clip.out_frame - clip.in_frame);
    const splitBin = Math.max(1, Math.min(clip.waveform_hi.length - 1, Math.round(clip.waveform_hi.length * ratio)));
    nextClips.push(
      {
        ...clip,
        clip_id: `${clip.clip_id}_L`,
        out_frame: splitFrame,
        waveform_hi: clip.waveform_hi.slice(0, splitBin),
        waveform_en: clip.waveform_en.slice(0, splitBin),
      },
      {
        ...clip,
        clip_id: `${clip.clip_id}_R`,
        in_frame: splitFrame,
        source_in_frame: clip.source_in_frame + leftDur,
        waveform_hi: clip.waveform_hi.slice(splitBin),
        waveform_en: clip.waveform_en.slice(splitBin),
      },
    );
  }

  const nextCaptions: KrCaptionEvent[] = [];
  for (const cap of timeline.captions) {
    if (splitFrame > cap.in_frame && splitFrame < cap.out_frame) {
      nextCaptions.push(
        { ...cap, caption_id: `${cap.caption_id}_L`, out_frame: splitFrame },
        { ...cap, caption_id: `${cap.caption_id}_R`, in_frame: splitFrame },
      );
    } else {
      nextCaptions.push(cap);
    }
  }

  const nextEffects: KrEffectSpan[] = [];
  for (const fx of timeline.effects) {
    if (splitFrame > fx.in_frame && splitFrame < fx.out_frame) {
      nextEffects.push(
        { ...fx, effect_id: `${fx.effect_id}_L`, out_frame: splitFrame },
        { ...fx, effect_id: `${fx.effect_id}_R`, in_frame: splitFrame },
      );
    } else {
      nextEffects.push(fx);
    }
  }

  const nextCuts: KrCutMarker[] = [
    ...timeline.cuts,
    { cut_id: `cut_split_${splitFrame}`, frame: splitFrame, kind: "manual_split" as const },
  ].sort((a, b) => a.frame - b.frame);

  return {
    ...timeline,
    version: timeline.version + 1,
    clips: nextClips,
    captions: nextCaptions,
    effects: nextEffects,
    cuts: nextCuts,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Ripple-trim a clip's out edge by deltaFrames (positive extends up to source_total_frames; negative shortens >= 12 frames).
 */
export function trimClipOutEdge(
  timeline: KrTimelineV1,
  clipId: string,
  deltaFrames: number,
): KrTimelineV1 {
  const idx = timeline.clips.findIndex((c) => c.clip_id === clipId);
  if (idx < 0) throw new Error(`Clip ${clipId} not found`);
  const clip = timeline.clips[idx];
  const minDur = 12;
  const maxOut = clip.in_frame + (clip.source_total_frames - clip.source_in_frame);
  const proposedOut = Math.max(clip.in_frame + minDur, Math.min(maxOut, clip.out_frame + deltaFrames));
  const actualDelta = proposedOut - clip.out_frame;
  if (actualDelta === 0) return timeline;

  const oldOut = clip.out_frame;
  const nextClips = timeline.clips.map((c, i) => {
    if (i === idx) return { ...c, out_frame: proposedOut };
    if (i > idx) return { ...c, in_frame: c.in_frame + actualDelta, out_frame: c.out_frame + actualDelta };
    return c;
  });

  const shiftAfterOldOut = (f: number) => (f >= oldOut ? f + actualDelta : f);

  const nextCaptions = timeline.captions.map((cap) => {
    if (cap.out_frame === oldOut && cap.scene_id === clip.scene_id) {
      return { ...cap, out_frame: proposedOut };
    }
    return {
      ...cap,
      in_frame: shiftAfterOldOut(cap.in_frame),
      out_frame: shiftAfterOldOut(cap.out_frame),
    };
  });

  const nextEffects = timeline.effects.map((fx) => {
    if (fx.out_frame === oldOut && fx.scene_id === clip.scene_id) {
      return { ...fx, out_frame: proposedOut };
    }
    return {
      ...fx,
      in_frame: shiftAfterOldOut(fx.in_frame),
      out_frame: shiftAfterOldOut(fx.out_frame),
    };
  });

  const nextKeyframes = timeline.keyframes.map((kf) => ({
    ...kf,
    frame: kf.frame >= oldOut ? kf.frame + actualDelta : kf.frame,
  }));

  const nextCuts: KrCutMarker[] = timeline.cuts.map((cut) => ({
    ...cut,
    frame: cut.frame >= oldOut ? cut.frame + actualDelta : cut.frame,
  }));

  const nextSuggestions: KrSilenceSuggestion[] = timeline.silence_suggestions
    .map((s) => {
      if (s.in_frame >= oldOut) {
        return { ...s, in_frame: s.in_frame + actualDelta, out_frame: s.out_frame + actualDelta };
      }
      if (s.out_frame > proposedOut) {
        if (s.in_frame >= proposedOut) return null;
        return { ...s, out_frame: proposedOut };
      }
      return s;
    })
    .filter((s): s is KrSilenceSuggestion => s !== null && s.out_frame > s.in_frame);

  return {
    ...timeline,
    version: timeline.version + 1,
    total_frames: recomputeTotalFrames(nextClips),
    clips: nextClips,
    captions: nextCaptions,
    effects: nextEffects,
    keyframes: nextKeyframes,
    cuts: nextCuts,
    silence_suggestions: nextSuggestions,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Ripple-trim a clip's in edge (source_in_frame) by deltaFrames:
 * positive delta trims start inward (shortens clip); negative delta restores earlier source frames down to 0.
 */
export function trimClipInEdge(
  timeline: KrTimelineV1,
  clipId: string,
  deltaFrames: number,
): KrTimelineV1 {
  const idx = timeline.clips.findIndex((c) => c.clip_id === clipId);
  if (idx < 0) throw new Error(`Clip ${clipId} not found`);
  const clip = timeline.clips[idx];
  const minDur = 12;
  const currentDur = clip.out_frame - clip.in_frame;
  const maxSourceIn = clip.source_in_frame + Math.max(0, currentDur - minDur);
  const proposedSourceIn = Math.max(
    0,
    Math.min(maxSourceIn, clip.source_in_frame + deltaFrames),
  );
  const actualSourceDelta = proposedSourceIn - clip.source_in_frame;
  if (actualSourceDelta === 0) return timeline;

  const outShift = -actualSourceDelta;
  const oldOut = clip.out_frame;
  const newOut = oldOut + outShift;

  const nextClips = timeline.clips.map((c, i) => {
    if (i === idx) {
      return {
        ...c,
        source_in_frame: proposedSourceIn,
        out_frame: newOut,
      };
    }
    if (i > idx) {
      return {
        ...c,
        in_frame: c.in_frame + outShift,
        out_frame: c.out_frame + outShift,
      };
    }
    return c;
  });

  const shiftAfterOldOut = (f: number) => (f >= oldOut ? f + outShift : f);

  const nextCaptions = timeline.captions.map((cap) => {
    if (cap.out_frame === oldOut && cap.scene_id === clip.scene_id) {
      return { ...cap, out_frame: newOut };
    }
    return {
      ...cap,
      in_frame: shiftAfterOldOut(cap.in_frame),
      out_frame: shiftAfterOldOut(cap.out_frame),
    };
  });

  const nextEffects = timeline.effects.map((fx) => {
    if (fx.out_frame === oldOut && fx.scene_id === clip.scene_id) {
      return { ...fx, out_frame: newOut };
    }
    return {
      ...fx,
      in_frame: shiftAfterOldOut(fx.in_frame),
      out_frame: shiftAfterOldOut(fx.out_frame),
    };
  });

  const nextKeyframes = timeline.keyframes.map((kf) => ({
    ...kf,
    frame: kf.frame >= oldOut ? kf.frame + outShift : kf.frame,
  }));

  const nextCuts: KrCutMarker[] = timeline.cuts.map((cut) => ({
    ...cut,
    frame: cut.frame >= oldOut ? cut.frame + outShift : cut.frame,
  }));

  const nextSuggestions: KrSilenceSuggestion[] = timeline.silence_suggestions
    .map((s) => {
      if (s.in_frame >= oldOut) {
        return { ...s, in_frame: s.in_frame + outShift, out_frame: s.out_frame + outShift };
      }
      if (s.out_frame > newOut) {
        if (s.in_frame >= newOut) return null;
        return { ...s, out_frame: newOut };
      }
      return s;
    })
    .filter((s): s is KrSilenceSuggestion => s !== null && s.out_frame > s.in_frame);

  return {
    ...timeline,
    version: timeline.version + 1,
    total_frames: recomputeTotalFrames(nextClips),
    clips: nextClips,
    captions: nextCaptions,
    effects: nextEffects,
    keyframes: nextKeyframes,
    cuts: nextCuts,
    silence_suggestions: nextSuggestions,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Auto-trimming silence on the real timeline is strictly forbidden unless BOTH
 * HI and EN audio assets overlapping the span are validated real audio (never demo/seeded).
 */
export function canAutoTrimSilenceSuggestion(
  timeline: KrTimelineV1,
  suggestion: Pick<KrSilenceSuggestion, "in_frame" | "out_frame">,
  probeMap: MediaProbeMap,
  checkpoints: readonly KrSceneCheckpoint[] = [],
): boolean {
  const overlapping = timeline.clips.filter(
    (c) => c.out_frame > suggestion.in_frame && c.in_frame < suggestion.out_frame,
  );
  if (overlapping.length === 0) return false;
  return overlapping.every((clip) => {
    const cp = checkpoints.find((item) => item.scene_id === clip.scene_id) ?? null;
    const status = classifyClipMediaStatus(clip, cp, probeMap);
    return status.hiAudio.state === "validated" && status.enAudio.state === "validated";
  });
}

export function applyMeasuredSilenceTrim(
  timeline: KrTimelineV1,
  suggestion: Pick<KrSilenceSuggestion, "in_frame" | "out_frame">,
  probeMap: MediaProbeMap,
  checkpoints: readonly KrSceneCheckpoint[] = [],
): KrTimelineV1 {
  if (!canAutoTrimSilenceSuggestion(timeline, suggestion, probeMap, checkpoints)) {
    throw new Error(
      "Cannot auto-trim timeline from demo or unvalidated silence suggestions.",
    );
  }
  return rippleDeleteRange(timeline, suggestion.in_frame, suggestion.out_frame);
}

export function updateAudioStem(
  timeline: KrTimelineV1,
  stemId: KrAudioStem["stem_id"],
  patch: Partial<Pick<KrAudioStem, "gain_db" | "muted" | "solo">>,
): KrTimelineV1 {
  const nextStems = timeline.stems.map((stem) => {
    if (stem.stem_id !== stemId) return stem;
    return {
      ...stem,
      gain_db:
        patch.gain_db !== undefined
          ? Math.max(-48, Math.min(12, Number(patch.gain_db)))
          : stem.gain_db,
      muted: patch.muted !== undefined ? patch.muted : stem.muted,
      solo: patch.solo !== undefined ? patch.solo : stem.solo,
    };
  });
  return {
    ...timeline,
    version: timeline.version + 1,
    stems: nextStems,
    updated_at: new Date().toISOString(),
  };
}

export interface EditorHistoryStack {
  past: KrTimelineV1[];
  present: KrTimelineV1;
  future: KrTimelineV1[];
}

export function createEditorHistory(initial: KrTimelineV1): EditorHistoryStack {
  return { past: [], present: initial, future: [] };
}

export function commitEditorEdit(
  history: EditorHistoryStack,
  nextTimeline: KrTimelineV1,
): EditorHistoryStack {
  if (nextTimeline === history.present) return history;
  return {
    past: [...history.past.slice(-39), history.present],
    present: nextTimeline,
    future: [],
  };
}

export function undoEditorHistory(history: EditorHistoryStack): EditorHistoryStack {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory(history: EditorHistoryStack): EditorHistoryStack {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
