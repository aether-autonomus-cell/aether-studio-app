import type { Fps, LanguageCode, SceneGraphV1 } from "./schema";

export const PCM_SAMPLE_RATE = 48_000;

export interface SceneAudioSamples {
  id: string;
  speechSamples: number;
  pauseSamples: number;
}

export interface TimedSceneBoundary {
  id: string;
  index: number;
  startSample: number;
  speechEndSample: number;
  endSample: number;
  startFrame: number;
  speechEndFrame: number;
  endFrame: number;
  frameCount: number;
  speechDurationSec: number;
  totalDurationSec: number;
}

export interface CumulativeTimeline {
  fps: Fps;
  sampleRate: number;
  totalSamples: number;
  totalFrames: number;
  totalDurationSec: number;
  boundaries: number[];
  scenes: TimedSceneBoundary[];
}

/**
 * Compute cumulative integer frame boundaries from per-scene PCM sample counts.
 * Formula: F_i = round(S_i * fps / 48000), matching worker/timing.py exactly.
 */
export function computeCumulativeBoundaries(
  durationsSamples: number[],
  fps: number,
): number[] {
  const boundaries: number[] = [0];
  let cumulative = 0;
  for (let i = 0; i < durationsSamples.length; i += 1) {
    const samples = Math.max(0, Math.round(durationsSamples[i] ?? 0));
    cumulative += samples;
    const rawFrame = Math.round((cumulative * fps) / PCM_SAMPLE_RATE);
    const prev = boundaries[boundaries.length - 1] ?? 0;
    const frame = samples > 0 ? Math.max(prev + 1, rawFrame) : prev;
    boundaries.push(frame);
  }
  return boundaries;
}

export function buildTimelineFromSpeech(
  sceneAudios: SceneAudioSamples[],
  fps: Fps,
): CumulativeTimeline {
  const totals = sceneAudios.map(
    (s) => Math.max(0, Math.round(s.speechSamples)) + Math.max(0, Math.round(s.pauseSamples)),
  );
  const boundaries = computeCumulativeBoundaries(totals, fps);
  const scenes: TimedSceneBoundary[] = [];

  let cumulativeSamples = 0;
  for (let i = 0; i < sceneAudios.length; i += 1) {
    const item = sceneAudios[i];
    const speechSamples = Math.max(0, Math.round(item.speechSamples));
    const pauseSamples = Math.max(0, Math.round(item.pauseSamples));
    const startSample = cumulativeSamples;
    const speechEndSample = startSample + speechSamples;
    const endSample = speechEndSample + pauseSamples;
    cumulativeSamples = endSample;

    const startFrame = boundaries[i] ?? 0;
    const endFrame = boundaries[i + 1] ?? startFrame + 1;
    const rawSpeechEndFrame = Math.round((speechEndSample * fps) / PCM_SAMPLE_RATE);
    const speechEndFrame = Math.max(startFrame, Math.min(endFrame, rawSpeechEndFrame));

    scenes.push({
      id: item.id,
      index: i,
      startSample,
      speechEndSample,
      endSample,
      startFrame,
      speechEndFrame,
      endFrame,
      frameCount: Math.max(1, endFrame - startFrame),
      speechDurationSec: speechSamples / PCM_SAMPLE_RATE,
      totalDurationSec: (speechSamples + pauseSamples) / PCM_SAMPLE_RATE,
    });
  }

  const totalFrames = Math.max(1, boundaries[boundaries.length - 1] ?? 1);
  return {
    fps,
    sampleRate: PCM_SAMPLE_RATE,
    totalSamples: cumulativeSamples,
    totalFrames,
    totalDurationSec: cumulativeSamples / PCM_SAMPLE_RATE,
    boundaries,
    scenes,
  };
}

/**
 * Estimate speech + pause PCM samples for browser preview before Colab Edge-TTS runs.
 * Uses spoken character cadence (~14.2 chars/sec EN, ~13.0 chars/sec HI) clamped by scene hint.
 */
export function estimateSceneSamples(
  narrationText: string,
  pauseMs: number,
  durationHintSec: number,
  language: LanguageCode,
): { speechSamples: number; pauseSamples: number } {
  const clean = narrationText.trim();
  const cps = language === "hi-IN" ? 13.0 : 14.5;
  const estimatedSec =
    clean.length > 0 ? Math.max(2.0, Math.min(28.0, clean.length / cps + 0.45)) : durationHintSec;
  const speechSec = clean.length > 0 ? (estimatedSec * 0.65 + durationHintSec * 0.35) : durationHintSec;
  const speechSamples = Math.round(Math.max(1.2, speechSec) * PCM_SAMPLE_RATE);
  const pauseSamples = Math.round((Math.max(0, pauseMs) / 1000) * PCM_SAMPLE_RATE);
  return { speechSamples, pauseSamples };
}

export function estimateTimelineForJob(
  job: SceneGraphV1,
  language: LanguageCode,
): CumulativeTimeline {
  const audios: SceneAudioSamples[] = job.project.scenes.map((scene) => {
    const text =
      scene.narration[language]?.trim() ||
      scene.narration[language === "hi-IN" ? "en-US" : "hi-IN"]?.trim() ||
      "";
    const est = estimateSceneSamples(
      text,
      scene.pause_after_ms,
      scene.duration_hint_sec,
      language,
    );
    return {
      id: scene.id,
      speechSamples: est.speechSamples,
      pauseSamples: est.pauseSamples,
    };
  });
  return buildTimelineFromSpeech(audios, job.project.fps);
}

export interface FrameLookup {
  sceneIndex: number;
  scene: TimedSceneBoundary;
  localFrame: number;
  localProgress: number;
  isSpeaking: boolean;
  speechEnvelope: number;
}

export function findSceneAtFrame(
  timeline: CumulativeTimeline,
  frameIndex: number,
): FrameLookup {
  const clamped = Math.max(0, Math.min(timeline.totalFrames - 1, Math.floor(frameIndex)));
  const scenes = timeline.scenes;
  let chosen = scenes[scenes.length - 1];
  for (let i = 0; i < scenes.length; i += 1) {
    const s = scenes[i];
    if (clamped >= s.startFrame && clamped < s.endFrame) {
      chosen = s;
      break;
    }
  }
  const localFrame = Math.max(0, clamped - chosen.startFrame);
  const denom = Math.max(1, chosen.frameCount - 1);
  const localProgress = Math.min(1, localFrame / denom);
  const isSpeaking = clamped < chosen.speechEndFrame;
  // Deterministic lip-sync amplitude envelope (0..1)
  const t = localFrame / timeline.fps;
  const speechEnvelope = isSpeaking
    ? Math.max(
        0.08,
        Math.min(1, 0.52 + 0.34 * Math.sin(t * 17.3 + chosen.index) + 0.18 * Math.cos(t * 29.1)),
      )
    : 0;

  return {
    sceneIndex: chosen.index,
    scene: chosen,
    localFrame,
    localProgress,
    isSpeaking,
    speechEnvelope,
  };
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}
