/**
 * KathaRift Studio — Canonical Frame & Sample Timing Math
 *
 * - Picture rate: 24 fps integer frames (half-open intervals [in_frame, out_frame)).
 * - Audio master sample rate: 48,000 Hz (48,000 / 24 = 2,000 samples per frame).
 * - Cumulative frame boundary rounding: round(N * 24 / 48000) prevents cumulative A/V drift.
 */

export const KR_FPS = 24 as const;
export const KR_SAMPLE_RATE = 48_000 as const;
export const KR_SAMPLES_PER_FRAME = KR_SAMPLE_RATE / KR_FPS; // 2000

export interface HalfOpenFrameSpan {
  inFrame: number;
  outFrame: number;
}

export function assertValidFrameSpan(span: HalfOpenFrameSpan, label = "span"): void {
  if (!Number.isInteger(span.inFrame) || !Number.isInteger(span.outFrame)) {
    throw new Error(`${label}: frame bounds must be integers (${span.inFrame}, ${span.outFrame})`);
  }
  if (span.inFrame < 0) {
    throw new Error(`${label}: inFrame must be >= 0 (got ${span.inFrame})`);
  }
  if (span.outFrame <= span.inFrame) {
    throw new Error(`${label}: half-open interval requires outFrame > inFrame (${span.inFrame}, ${span.outFrame})`);
  }
}

export function spanDurationFrames(span: HalfOpenFrameSpan): number {
  assertValidFrameSpan(span);
  return span.outFrame - span.inFrame;
}

export function samplesToFramesRound(samples: number): number {
  if (!Number.isFinite(samples) || samples < 0) {
    throw new Error(`samples must be >= 0 (got ${samples})`);
  }
  return Math.round((samples * KR_FPS) / KR_SAMPLE_RATE);
}

export function framesToSamples(frames: number): number {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error(`frames must be a non-negative integer (got ${frames})`);
  }
  return Math.round((frames * KR_SAMPLE_RATE) / KR_FPS);
}

export function msToFramesRound(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`ms must be >= 0 (got ${ms})`);
  }
  return Math.round((ms * KR_FPS) / 1000);
}

export function framesToMs(frames: number): number {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error(`frames must be a non-negative integer (got ${frames})`);
  }
  return Math.round((frames * 1000) / KR_FPS);
}

/**
 * Given per-scene durations in audio samples, allocate half-open integer frame intervals
 * using cumulative sample boundaries rounded via round(N_cum * 24 / 48000).
 * This eliminates per-scene rounding drift across multi-minute films.
 */
export function allocateCumulativeFrameSpans(
  sampleCounts: readonly number[],
  minFramesPerScene = 24,
): HalfOpenFrameSpan[] {
  const spans: HalfOpenFrameSpan[] = [];
  let cumulativeSamples = 0;
  let prevEndFrame = 0;

  for (let i = 0; i < sampleCounts.length; i += 1) {
    const count = Math.max(0, Math.round(sampleCounts[i] ?? 0));
    cumulativeSamples += count;
    const rawEndFrame = samplesToFramesRound(cumulativeSamples);
    const endFrame = Math.max(prevEndFrame + minFramesPerScene, rawEndFrame);
    spans.push({ inFrame: prevEndFrame, outFrame: endFrame });
    prevEndFrame = endFrame;
  }
  return spans;
}

export function framesToSrtTimestamp(frame: number): string {
  const totalMs = Math.max(0, framesToMs(Math.max(0, Math.round(frame))));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "," +
    String(millis).padStart(3, "0")
  );
}

export function formatTimecode(frame: number, fps = KR_FPS): string {
  const safeFrame = Math.max(0, Math.floor(frame));
  const totalSeconds = Math.floor(safeFrame / fps);
  const remFrames = safeFrame % fps;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(remFrames).padStart(2, "0")}`;
}
