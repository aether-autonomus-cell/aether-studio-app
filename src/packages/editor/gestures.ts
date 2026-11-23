export const MIN_TIMELINE_PX_PER_FRAME = 0.5;
export const MAX_TIMELINE_PX_PER_FRAME = 4.0;
export const DEFAULT_TIMELINE_PX_PER_FRAME = 1.5;

export function clampZoomPxPerFrame(pxPerFrame: number): number {
  if (!Number.isFinite(pxPerFrame)) return DEFAULT_TIMELINE_PX_PER_FRAME;
  return Math.max(
    MIN_TIMELINE_PX_PER_FRAME,
    Math.min(MAX_TIMELINE_PX_PER_FRAME, Number(pxPerFrame.toFixed(2))),
  );
}

export function frameFromTrackClientX(params: {
  clientX: number;
  trackViewportLeft: number;
  scrollLeft: number;
  pxPerFrame: number;
  totalFrames: number;
  leadingPaddingPx?: number;
}): number {
  const maxFrame = Math.max(0, params.totalFrames - 1);
  if (maxFrame === 0 || params.pxPerFrame <= 0) return 0;
  const pad = params.leadingPaddingPx ?? 0;
  const contentX = params.clientX - params.trackViewportLeft + params.scrollLeft - pad;
  const rawFrame = Math.round(contentX / params.pxPerFrame);
  return Math.max(0, Math.min(maxFrame, rawFrame));
}

export function computeTrimDeltaFrames(params: {
  startClientX: number;
  currentClientX: number;
  pxPerFrame: number;
}): number {
  if (!Number.isFinite(params.pxPerFrame) || params.pxPerFrame <= 0) return 0;
  const dx = params.currentClientX - params.startClientX;
  return Math.round(dx / params.pxPerFrame);
}

export function computeScrollLeftForPlayhead(params: {
  playheadFrame: number;
  pxPerFrame: number;
  viewportWidth: number;
  currentScrollLeft: number;
  leadingPaddingPx?: number;
}): number {
  if (params.viewportWidth <= 0) return params.currentScrollLeft;
  const pad = params.leadingPaddingPx ?? 0;
  const playheadX = pad + params.playheadFrame * params.pxPerFrame;
  const leftMargin = params.currentScrollLeft + 24;
  const rightMargin = params.currentScrollLeft + params.viewportWidth - 36;
  if (playheadX < leftMargin) {
    return Math.max(0, playheadX - 36);
  }
  if (playheadX > rightMargin) {
    return Math.max(0, playheadX - params.viewportWidth * 0.65);
  }
  return params.currentScrollLeft;
}

export function dbToLinearGain(gainDb: number, muted: boolean): number {
  if (muted || !Number.isFinite(gainDb) || gainDb <= -48) return 0;
  return Math.max(0, Math.min(1, Math.pow(10, gainDb / 20)));
}
