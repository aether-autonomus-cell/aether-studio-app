import type { AspectRatio, LanguageCode } from "../schema";

export interface SafeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
}

/**
 * Aspect-aware safe areas:
 * - Portrait 9:16: 7% left/right, 8% top, 15% bottom (clears Shorts/Reels overlays)
 * - Landscape 16:9: 5% outer margins
 */
export function getSafeBox(
  width: number,
  height: number,
  aspectRatio: AspectRatio,
): SafeBox {
  const isPortrait = aspectRatio === "9:16" || height > width;
  const ml = Math.round(width * (isPortrait ? 0.07 : 0.05));
  const mr = Math.round(width * (isPortrait ? 0.07 : 0.05));
  const mt = Math.round(height * (isPortrait ? 0.08 : 0.05));
  const mb = Math.round(height * (isPortrait ? 0.15 : 0.05));
  return {
    x: ml,
    y: mt,
    width: Math.max(40, width - ml - mr),
    height: Math.max(40, height - mt - mb),
    right: width - mr,
    bottom: height - mb,
    marginLeft: ml,
    marginRight: mr,
    marginTop: mt,
    marginBottom: mb,
  };
}

/**
 * Grapheme-cluster splitter using Intl.Segmenter so Devanagari vowel signs
 * (matras) and conjunct ligatures are never sliced mid-cluster.
 */
export function splitGraphemes(text: string, lang: LanguageCode = "en-US"): string[] {
  const clean = text ?? "";
  if (!clean) return [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const seg = new Intl.Segmenter(lang === "hi-IN" ? "hi" : "en", {
      granularity: "grapheme",
    });
    return Array.from(seg.segment(clean), (s) => s.segment);
  }
  return Array.from(clean);
}

export interface TextMeasurer {
  measureText: (text: string) => { width: number };
}

export function fontFamilyForLanguage(lang: LanguageCode, display = false): string {
  if (lang === "hi-IN") {
    return "'Noto Sans Devanagari', 'Inter', sans-serif";
  }
  return display
    ? "'Space Grotesk', 'Inter', 'Noto Sans Devanagari', sans-serif"
    : "'Inter', 'Noto Sans Devanagari', sans-serif";
}

/**
 * Word- and grapheme-cluster-aware pixel width wrapper.
 * Never truncates Devanagari clusters mid-ligature.
 */
export function wrapTextMeasured(
  measurer: TextMeasurer,
  text: string,
  maxWidth: number,
  lang: LanguageCode = "en-US",
  maxLines = 4,
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (measurer.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (measurer.measureText(word).width <= maxWidth) {
      current = word;
    } else {
      // Break an oversized token along grapheme clusters only
      const clusters = splitGraphemes(word, lang);
      let chunk = "";
      for (const g of clusters) {
        const nextChunk = chunk + g;
        if (measurer.measureText(nextChunk).width <= maxWidth || !chunk) {
          chunk = nextChunk;
        } else {
          lines.push(chunk);
          chunk = g;
        }
      }
      current = chunk;
    }
  }

  if (current) lines.push(current);

  if (maxLines > 0 && lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    const lastIdx = maxLines - 1;
    const clusters = splitGraphemes(clipped[lastIdx], lang);
    while (
      clusters.length > 1 &&
      measurer.measureText(clusters.join("") + "…").width > maxWidth
    ) {
      clusters.pop();
    }
    clipped[lastIdx] = clusters.join("") + "…";
    return clipped;
  }

  return lines;
}
