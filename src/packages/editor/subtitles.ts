import type { KrCaptionEvent, KrTimelineV1 } from "../contracts/schemas.ts";

export interface TimedSubtitleCue {
  cueIndex: number;
  totalCues: number;
  inFrame: number;
  outFrame: number;
  hiLine: string | null;
  enLine: string | null;
}

/**
 * Split a narration line into concise subtitle chunks (typically 1-2 lines on a phone screen)
 * along natural sentence, em-dash, comma, and word boundaries.
 */
export function splitIntoSubtitleCues(text: string, maxCharsPerCue = 64): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxCharsPerCue) return [clean];

  // First split on sentence / em-dash boundaries while keeping punctuation attached
  const rawSegments = clean
    .split(/(?<=[।.!?—])\s+|(?<=—)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const segments = rawSegments.length > 0 ? rawSegments : [clean];
  const chunks: string[] = [];

  for (const segment of segments) {
    if (segment.length <= maxCharsPerCue) {
      chunks.push(segment);
      continue;
    }

    // Split longer sentences on commas or word boundaries
    const words = segment.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }
      if (current.length + 1 + word.length <= maxCharsPerCue) {
        current += ` ${word}`;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

function pickTimedChunk(
  chunks: string[],
  captionIn: number,
  captionOut: number,
  playheadFrame: number,
): { text: string; index: number; inFrame: number; outFrame: number } | null {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) {
    return { text: chunks[0], index: 0, inFrame: captionIn, outFrame: captionOut };
  }

  const totalSpan = Math.max(1, captionOut - captionIn);
  const clampedFrame = Math.max(captionIn, Math.min(captionOut - 1, playheadFrame));
  const totalChars = chunks.reduce((sum, c) => sum + Math.max(1, c.length), 0);

  let cursor = captionIn;
  for (let i = 0; i < chunks.length; i += 1) {
    const share = Math.max(1, chunks[i].length) / totalChars;
    const isLast = i === chunks.length - 1;
    const nextCursor = isLast
      ? captionOut
      : Math.min(captionOut, Math.max(cursor + 1, Math.round(cursor + totalSpan * share)));
    if (clampedFrame < nextCursor || isLast) {
      return {
        text: chunks[i],
        index: i,
        inFrame: cursor,
        outFrame: nextCursor,
      };
    }
    cursor = nextCursor;
  }

  return {
    text: chunks[chunks.length - 1],
    index: chunks.length - 1,
    inFrame: captionIn,
    outFrame: captionOut,
  };
}

/**
 * Resolve the active 1-2 line timed subtitle cue at `playheadFrame` for the chosen caption mode.
 */
export function getTimedSubtitleCue(
  caption: KrCaptionEvent | null,
  playheadFrame: number,
  captionMode: KrTimelineV1["active_caption_lang"],
): TimedSubtitleCue | null {
  if (!caption || captionMode === "off") return null;

  const showHi = captionMode === "hi" || captionMode === "both";
  const showEn = captionMode === "en" || captionMode === "both";
  if (!showHi && !showEn) return null;

  const hiChunks = showHi ? splitIntoSubtitleCues(caption.hi_text, 62) : [];
  const enChunks = showEn ? splitIntoSubtitleCues(caption.en_text, 66) : [];

  const hiPick = showHi
    ? pickTimedChunk(hiChunks, caption.in_frame, caption.out_frame, playheadFrame)
    : null;
  const enPick = showEn
    ? pickTimedChunk(enChunks, caption.in_frame, caption.out_frame, playheadFrame)
    : null;

  if (!hiPick && !enPick) return null;

  const primary = hiPick ?? enPick!;
  return {
    cueIndex: primary.index,
    totalCues: Math.max(hiChunks.length, enChunks.length),
    inFrame: primary.inFrame,
    outFrame: primary.outFrame,
    hiLine: hiPick?.text ?? null,
    enLine: enPick?.text ?? null,
  };
}
