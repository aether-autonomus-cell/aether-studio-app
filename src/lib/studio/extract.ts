export type SourcePanel = { src: string; text: string; bubble: string; aside: string };

export type SourcePlatform = "wtr-lab" | "youtube" | "bilibili" | "reddit" | "web";

export const JINA_TARGET_SELECTOR = "article, .chapter-body, .reader-content, main, body";

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
const UNSAFE_SCRAPE_MARKER = /adform(?:\.net)?|prebid|set-cookie|1x1\s+image|tracker\s+probe/i;
const TRACKER_OR_COOKIE_LINE = /\b(?:adform(?:\.net)?|prebid|set-cookie|cookie)\b/i;

export function hasUnsafeScrapeMarker(value: string): boolean {
  return UNSAFE_SCRAPE_MARKER.test(value);
}

function stripScraperNoise(value: string): string {
  return value
    .replace(/^[\t ]*(?:set-cookie|cookie)\s*:[^\n]*/gim, "")
    .replace(/https?:\/\/[^\s]*(?:adform|prebid)[^\s]*/gi, " ")
    .replace(/\b(?:adform(?:\.net)?|prebid(?:\.js)?)\b[^\n]*/gi, " ")
    .replace(/This is a cached snapshot[\s\S]*?\bprobe\b/gi, " ")
    .replace(/Ad Blocker Detected[\s\S]*?\bcontent[.!]?/gi, " ")
    .replace(/(?:please\s+)?(?:disable|turn off)\s+(?:your\s+)?ad[\s-]?block(?:er)?[^.!?\n]*[.!?]?/gi, " ");
}

/** Drop ads, nav, chapter chrome, and site names. Keep the story, including a long ending. */
export function sanitizeNovelText(raw: string): string {
  const lines = stripScraperNoise(decodeEntities(raw))
    .split(/\n+/)
    .map((line) => stripChrome(line))
    .filter(
      (line) =>
        line.length > 0 &&
        !LONE_LABEL.test(line) &&
        !AD_WARNING.test(line) &&
        !TRACKER_OR_COOKIE_LINE.test(line) &&
        !/^[\d.%\s/#+-]+$/.test(line),
    );
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

export function extractNextData(html: string): { title: string; text: string } | null {
  const nextData = html.match(
    /<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!nextData) return null;
  try {
    const embedded = nextDataChapter(JSON.parse(nextData) as unknown);
    if (embedded.text) return embedded;
  } catch {
    return null;
  }
  return null;
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleRaw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = sanitizeNovelText(visibleText(titleRaw)).replace(/\s+-\s*$/, "").trim();
  const embedded = extractNextData(html);
  if (embedded?.text) {
    return { title: embedded.title || title, text: embedded.text };
  }
  const selectedRegion = region(html);
  const paragraphs = [...selectedRegion.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((paragraph) => sanitizeNovelText(visibleText(paragraph[1] ?? "")))
    .filter(Boolean);
  const text = sanitizeNovelText(
    paragraphs.length ? paragraphs.join("\n") : visibleText(selectedRegion),
  );
  return { title, text };
}

function nextDataChapter(value: unknown): { title: string; text: string } {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const props = root.props && typeof root.props === "object" ? (root.props as Record<string, unknown>) : {};
  const pageProps = props.pageProps;
  const stack: unknown[] = [pageProps && typeof pageProps === "object" ? pageProps : value];
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

export function detectSourcePlatform(rawUrl: string): SourcePlatform {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "web";
  }
  if (host === "wtr-lab.com") return "wtr-lab";
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "youtube";
  if (host === "bilibili.com" || host === "b23.tv") return "bilibili";
  if (host === "reddit.com" || host === "old.reddit.com" || host === "redd.it") return "reddit";
  return "web";
}

export function extractYoutubeContent(raw: string): { title: string; text: string } {
  const xmlLines = [...raw.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((m) => sanitizeNovelText(decodeEntities(m[1] ?? "")))
    .filter(Boolean);
  if (xmlLines.length > 3) {
    return { title: "YouTube Transcript", text: xmlLines.join("\n") };
  }
  const titleMatch =
    raw.match(/"videoDetails"\s*:\s*\{[\s\S]*?"title"\s*:\s*"([^"]+)"/)?.[1] ||
    raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    "";
  const descMatch = raw.match(/"shortDescription"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] || "";
  const title = sanitizeNovelText(titleMatch.replace(/ - YouTube$/i, ""));
  let desc = "";
  if (descMatch) {
    try {
      desc = sanitizeNovelText(JSON.parse(`"${descMatch}"`) as string);
    } catch {
      desc = sanitizeNovelText(descMatch);
    }
  }
  const htmlParsed = htmlToText(raw);
  const combined = [desc, htmlParsed.text].filter((part) => part.length > 30).join("\n\n");
  return { title: title || htmlParsed.title || "YouTube Video", text: sanitizeNovelText(combined) };
}

export function extractBilibiliContent(raw: string): { title: string; text: string } {
  try {
    const json = JSON.parse(raw) as { body?: { content?: string }[] };
    if (Array.isArray(json.body)) {
      const lines = json.body
        .map((row) => (typeof row.content === "string" ? sanitizeNovelText(row.content) : ""))
        .filter(Boolean);
      if (lines.length) return { title: "Bilibili Transcript", text: lines.join("\n") };
    }
  } catch {
    /* html or markdown fallback */
  }
  const stateMatch = raw.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*\(function/i)?.[1];
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch) as { videoData?: { title?: string; desc?: string } };
      const title = sanitizeNovelText(state.videoData?.title || "");
      const desc = sanitizeNovelText(state.videoData?.desc || "");
      if (title || desc) return { title: title || "Bilibili Video", text: desc || title };
    } catch {
      /* ignore malformed initial state */
    }
  }
  const parsed = htmlToText(raw);
  return { title: parsed.title || "Bilibili Video", text: parsed.text };
}

export function extractRedditContent(raw: string): { title: string; text: string } {
  try {
    const json = JSON.parse(raw) as unknown;
    const listings = Array.isArray(json) ? json : [json];
    const post = (listings[0] as { data?: { children?: { data?: Record<string, unknown> }[] } })?.data
      ?.children?.[0]?.data;
    if (post && typeof post === "object") {
      const title = sanitizeNovelText(String(post.title ?? ""));
      const selftext = sanitizeNovelText(String(post.selftext ?? ""));
      const commentsListing = (listings[1] as { data?: { children?: { data?: Record<string, unknown> }[] } })?.data
        ?.children ?? [];
      const comments = commentsListing
        .map((item) => {
          const author = typeof item.data?.author === "string" ? item.data.author : "";
          const body = typeof item.data?.body === "string" ? sanitizeNovelText(item.data.body) : "";
          return body ? `${author ? `${author}: ` : ""}${body}` : "";
        })
        .filter(Boolean)
        .slice(0, 20);
      const text = [selftext, ...comments].filter(Boolean).join("\n\n");
      if (title || text) return { title: title || "Reddit Thread", text: text || title };
    }
  } catch {
    /* HTML or text fallback */
  }
  const parsed = htmlToText(raw);
  return { title: parsed.title || "Reddit Thread", text: parsed.text };
}

export function extractPlatformText(
  raw: string,
  pageUrl: string,
): { title: string; text: string; panels: SourcePanel[] } {
  if (hasUnsafeScrapeMarker(pageUrl)) return { title: "", text: "", panels: [] };
  const platform = detectSourcePlatform(pageUrl);
  if (platform === "youtube") {
    const yt = extractYoutubeContent(raw);
    return { ...yt, panels: [] };
  }
  if (platform === "bilibili") {
    const bili = extractBilibiliContent(raw);
    return { ...bili, panels: [] };
  }
  if (platform === "reddit") {
    const reddit = extractRedditContent(raw);
    return { ...reddit, panels: [] };
  }
  const parsed = htmlToText(raw);
  const panels = /<[a-z][\s\S]*>/i.test(raw) ? extractPanels(raw, pageUrl) : [];
  return { title: parsed.title, text: parsed.text, panels };
}

export type AgentReachWorkerFn = (
  path: "/api/v1/fetch" | "/scrape" | "/api/v2/scrape",
  url: string,
) => Promise<unknown | null>;

function extractWorkerString(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 500_000);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["html", "content", "body", "text"]) {
    if (typeof row[key] === "string" && (row[key] as string).trim()) {
      return (row[key] as string).slice(0, 500_000);
    }
  }
  if (Array.isArray(row.pages) && row.pages[0] && typeof row.pages[0] === "object") {
    const page = row.pages[0] as Record<string, unknown>;
    if (typeof page.text === "string" && page.text.trim()) {
      return page.text.slice(0, 500_000);
    }
  }
  return null;
}

function parseJinaText(raw: string, pageUrl: string): { title: string; text: string } {
  const titleLine = raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const body = raw
    .replace(/^Title:\s*.+$/m, "")
    .replace(/^URL Source:\s*.+$/m, "")
    .replace(/^Markdown Content:\s*/m, "");
  const extracted = extractPlatformText(
    /<[a-z][\s\S]*>/i.test(body) ? body : `<title>${titleLine}</title><article><p>${body}</p></article>`,
    pageUrl,
  );
  return {
    title: sanitizeNovelText(extracted.title || titleLine),
    text: sanitizeNovelText(extracted.text),
  };
}

/**
 * Agent-Reach ordered fallback chain:
 * a) Connected Colab worker (/api/v1/fetch or /scrape)
 * b) Codetabs proxy (https://api.codetabs.com/v1/proxy?quest={encoded_url})
 * c) AllOrigins raw proxy (https://api.allorigins.win/raw?url={encoded_url})
 * d) Jina Reader API (https://r.jina.ai/{url}) with X-Return-Format: text & X-Target-Selector
 */
export async function fetchWithAgentReachFallback(
  pageUrl: string,
  options: {
    workerScrape?: AgentReachWorkerFn;
    minLength?: number;
  } = {},
): Promise<{ title: string; text: string; panels: SourcePanel[]; sourceVia: "worker" | "codetabs" | "allorigins" | "jina" } | null> {
  if (hasUnsafeScrapeMarker(pageUrl)) return null;
  const minLen = options.minLength ?? 80;
  const encoded = encodeURIComponent(pageUrl);

  // a) Connected Colab worker (/api/v1/fetch or /scrape)
  if (options.workerScrape) {
    for (const path of ["/api/v1/fetch", "/scrape"] as const) {
      try {
        const res = await options.workerScrape(path, pageUrl);
        const raw = extractWorkerString(res);
        if (!raw) continue;
        const extracted = extractPlatformText(raw, pageUrl);
        if (extracted.text.length >= minLen && !hasUnsafeScrapeMarker(`${extracted.title}\n${extracted.text}`)) {
          return { ...extracted, sourceVia: "worker" };
        }
      } catch {
        continue;
      }
    }
  }

  // b) Codetabs proxy -> c) AllOrigins raw proxy
  const proxies: { via: "codetabs" | "allorigins"; endpoint: string }[] = [
    { via: "codetabs", endpoint: `https://api.codetabs.com/v1/proxy?quest=${encoded}` },
    { via: "allorigins", endpoint: `https://api.allorigins.win/raw?url=${encoded}` },
  ];
  for (const proxy of proxies) {
    let response: Response;
    try {
      response = await fetch(proxy.endpoint, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8" },
      });
    } catch {
      continue;
    }
    if (!response.ok || hasUnsafeScrapeMarker(response.url || proxy.endpoint)) continue;
    const raw = (await response.text()).slice(0, 500_000);
    if (hasUnsafeScrapeMarker(raw)) {
      const cleaned = sanitizeNovelText(raw);
      if (cleaned.length < minLen) continue;
    }
    const extracted = extractPlatformText(raw, pageUrl);
    if (
      (extracted.text.length >= minLen || extracted.panels.length > 0) &&
      !hasUnsafeScrapeMarker(`${extracted.title}\n${extracted.text}`)
    ) {
      return { ...extracted, sourceVia: proxy.via };
    }
  }

  // d) Jina Reader API
  let jinaUrl: URL;
  try {
    jinaUrl = new URL(`https://r.jina.ai/${pageUrl}`);
  } catch {
    return null;
  }
  try {
    const response = await fetch(jinaUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "text/plain, text/markdown, */*",
        "X-Return-Format": "text",
        "X-Target-Selector": JINA_TARGET_SELECTOR,
      },
    });
    if (!response.ok || hasUnsafeScrapeMarker(response.url || jinaUrl.toString())) return null;
    const raw = (await response.text()).slice(0, 500_000);
    const parsed = parseJinaText(raw, pageUrl);
    if (parsed.text.length >= minLen && !hasUnsafeScrapeMarker(`${parsed.title}\n${parsed.text}`)) {
      return { title: parsed.title, text: parsed.text, panels: [], sourceVia: "jina" };
    }
  } catch {
    return null;
  }

  return null;
}
