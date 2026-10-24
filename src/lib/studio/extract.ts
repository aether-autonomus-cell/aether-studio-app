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

/** Drop ads, nav, chapter chrome, and site names. Keep the story, including a long ending. */
export function sanitizeNovelText(raw: string): string {
  const lines = decodeEntities(raw)
    .split(/\n+/)
    .map((line) => stripChrome(line))
    .filter((line) => line.length > 0 && !LONE_LABEL.test(line) && !/^[\d.%\s/#+-]+$/.test(line));
  return lines.join("\n").trim();
}

function region(html: string): string {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i);
  if (article) return article[0];
  const main = html.match(/<main\b[\s\S]*?<\/main>/i);
  if (main) return main[0];
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
  const text = sanitizeNovelText(visibleText(region(html)));
  return { title, text };
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
    if ((quoted || line.length <= 90) && line.length <= 160) bubbleLines.push(line);
    else asideLines.push(line);
  }
  const bubble = bubbleLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
  const aside = asideLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
  const text = [bubble, aside].filter(Boolean).join(" ").trim();
  return { bubble, aside, text };
}

/** Panel images in reading order. Alt and short lines are bubble dialogue. The rest sits near the face. */
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
