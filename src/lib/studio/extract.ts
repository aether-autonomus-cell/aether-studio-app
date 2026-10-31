export type SourcePanel = { src: string; text: string; bubble: string; aside: string };

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: String.fromCharCode(34),
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key]! : match;
  });
}

function stripChrome(value: string): string {
  return value
    .replace(/wtr-?lab/gi, " ")
    .replace(/ch\.\s*\d+\s*\/\s*\d+/gi, " ")
    .replace(/\d+(?:\.\d+)?%\s*web/gi, " ")
    .replace(/#\d+\s*chapter/gi, " ")
    .replace(/\b(?:next|previous)\s+chapter\b/gi, " ")
    .replace(/\bhome\s*\|\s*novels\s*\|\s*library\s*\|\s*ranking\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LONE_LABEL = /^(novel|novels|web|mtl|machine translation|next chapter|previous chapter|library|ranking|home|comments?|login|sign in)$/i;
const AD_WARNING = /(?:ad[\s-]?block(?:er)?\s*(?:detected|warning|is enabled)|please\s+(?:disable|turn off)\s+(?:your\s+)?ad[\s-]?block(?:er)?|your ad[\s-]?block(?:er)?)|(?:enable javascript and cookies|cookies? must be enabled)/i;
const UNSAFE_SCRAPE_MARKER = /adform\.net|prebid|1x1\s+image|tracker\s+probe/i;

export function hasUnsafeScrapeMarker(value: string): boolean {
  return UNSAFE_SCRAPE_MARKER.test(value);
}

function stripScraperNoise(value: string): string {
  return value
    .replace(/^[\t ]*(?:set-cookie|cookie)\s*:[^\n]*/gim, "")
    .replace(/This is a cached snapshot[\s\S]*?\bprobe\b/gi, " ")
    .replace(/Ad Blocker Detected[\s\S]*?\bcontent[.!]?/gi, " ")
    .replace(/(?:please\s+)?(?:disable|turn off)\s+(?:your\s+)?ad[\s-]?block(?:er)?[^.!?\n]*[.!?]?/gi, " ");
}

/** Drop ads, nav, chapter chrome, and site names. Keep the story, including a long ending. */
export function sanitizeNovelText(raw: string): string {
  const lines = stripScraperNoise(decodeEntities(raw))
    .split(/\n+/)
    .map((line) => stripChrome(line))
    .filter((line) => line.length > 0 && !LONE_LABEL.test(line) && !AD_WARNING.test(line) && !/^[\d.%\s/#+-]+$/.test(line));
  return lines.join("\n").trim();
}

function matchingElement(html: string, opening: RegExpExecArray): string | null {
  const tag = opening[1];
  if (!tag || opening.index === undefined) return null;
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  token.lastIndex = opening.index;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/>$/.test(match[0])) depth += 1;
    if (depth === 0) return html.slice(opening.index, token.lastIndex);
  }
  return null;
}

function region(html: string): string {
  const chapter =
    /<(article|main|section|div)\b(?=[^>]*(?:class|id)=["'][^"']*(?:chapter[-_ ]?(?:body|content)|reader[-_ ]?content|reading[-_ ]?content)[^"']*["'])[^>]*>/i.exec(
      html,
    );
  const chapterRegion = chapter ? matchingElement(html, chapter) : null;
  if (chapterRegion) return chapterRegion;
  for (const tag of ["article", "main"]) {
    const opening = new RegExp(`<(${tag})\\b[^>]*>`, "i").exec(html);
    const found = opening ? matchingElement(html, opening) : null;
    if (found) return found;
  }
  const body = html.match(/<body\b[\s\S]*?<\/body>/i);
  return body?.[0] ?? html;
}

function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleRaw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = sanitizeNovelText(visibleText(titleRaw)).replace(/\s+-\s*$/, "").trim();
  const selectedRegion = region(html);
  const paragraphs = [...selectedRegion.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((paragraph) => sanitizeNovelText(visibleText(paragraph[1] ?? "")))
    .filter(Boolean);
  const text = sanitizeNovelText(
    paragraphs.length ? paragraphs.join("\n") : visibleText(selectedRegion),
  );
  const nextData = html.match(
    /<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (nextData) {
    try {
      const embedded = nextDataChapter(JSON.parse(nextData) as unknown);
      if (embedded.text.length > text.length)
        return { title: embedded.title || title, text: embedded.text };
    } catch {
      return { title, text };
    }
  }
  return { title, text };
}

function nextDataChapter(value: unknown): { title: string; text: string } {
  const stack: unknown[] = [value];
  let title = "";
  let bestText = "";
  const contentKeys = new Set([
    "body",
    "content",
    "text",
    "html",
    "paragraphs",
    "chaptercontent",
    "chapter_content",
  ]);
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const row = current as Record<string, unknown>;
    if (!title) {
      for (const key of ["chapter_title", "chapterTitle", "title"]) {
        if (typeof row[key] === "string" && row[key].trim()) {
          title = sanitizeNovelText(row[key] as string);
          break;
        }
      }
    }
    for (const [key, body] of Object.entries(row)) {
      if (contentKeys.has(key.toLowerCase())) {
        const parts = Array.isArray(body)
          ? body.filter((part): part is string => typeof part === "string")
          : typeof body === "string"
            ? [body]
            : [];
        const candidate = sanitizeNovelText(
          parts.map((part) => (/<[a-z][\s\S]*>/i.test(part) ? visibleText(part) : part)).join("\n"),
        );
        if (candidate.length > bestText.length) bestText = candidate;
      }
      if (body && typeof body === "object") stack.push(body);
    }
  }
  return { title, text: bestText };
}

function absUrl(src: string, pageUrl: string): string | null {
  try {
    const url = new URL(src, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function junkImage(src: string): boolean {
  return /logo|icon|sprite|avatar|emoji|banner|ads?\/|advert|pixel|thumb_small|loading|favicon|badge/i.test(src);
}

function splitNearby(alt: string, nearby: string): { bubble: string; aside: string; text: string } {
  const bubbleLines: string[] = [];
  const asideLines: string[] = [];
  const altLine = alt.replace(/\s+/g, " ").trim();
  if (altLine) bubbleLines.push(altLine.slice(0, 180));
  for (const line of nearby.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
    const quoted = /^["“「『']/.test(line) || /["”」』']$/.test(line);
    if ((quoted || /^[^:]{1,32}:\s/.test(line)) && line.length <= 160) bubbleLines.push(line);
    else asideLines.push(line);
  }
  const bubble = bubbleLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
  const aside = asideLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
  const text = [bubble, aside].filter(Boolean).join(" ").trim();
  return { bubble, aside, text };
}

/** Panel images in reading order. Alt text and quoted/speaker-labeled lines are bubble dialogue. */
export function extractPanels(html: string, pageUrl: string): SourcePanel[] {
  const body = region(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const pattern = /<img\b[^>]*>/gi;
  const tags = [...body.matchAll(pattern)];
  const panels: SourcePanel[] = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (!tag?.[0] || tag.index === undefined) continue;
    const srcMatch = tag[0].match(/\b(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)["']/i);
    const raw = srcMatch?.[1]?.trim() ?? "";
    if (!raw || raw.startsWith("data:") || junkImage(raw)) continue;
    const src = absUrl(raw, pageUrl);
    if (!src) continue;
    const alt = tag[0].match(/\balt=["']([^"']*)["']/i)?.[1] ?? "";
    const from = tag.index + tag[0].length;
    const to = tags[index + 1]?.index ?? Math.min(body.length, from + 800);
    const nearby = sanitizeNovelText(visibleText(body.slice(from, to))).slice(0, 500);
    panels.push({ src, ...splitNearby(alt, nearby) });
    if (panels.length >= 400) break;
  }
  return panels;
}

export function cleanScrapedChapter(text: string): string {
  if (!text) return "";
  return sanitizeNovelText(
    text
      .replace(/https?:\/\/[^\s]*adform[^\s]*/gi, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/[\u4e00-\u9fa5]+/g, ""),
  );
}
