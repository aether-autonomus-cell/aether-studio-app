/** Readable chapter text. Site chrome (WTR-LAB, chapter counters, nav) is stripped. */

const JUNK_LINE =
  /^(?:wtr[\s-]*lab(?:\s+novel)?|ch\.?\s*\d+\s*\/\s*\d+|chapter\s+\d+\s*(?:\/\s*\d+)?|#\s*\d+\s*chapters?|\d+\s*\/\s*\d+|\d{1,3}(?:\.\d+)?\s*%\s*web|home|menu|index|login|log\s*in|sign\s*in|sign\s*up|register|bookmark|library|ranking|novels?|comments?|next(?:\s+chapter)?|prev(?:ious)?(?:\s+chapter)?|table\s+of\s+contents|toc|share|report|donate|advertisement|ads?|translator(?:'s)?(?:\s+notes?)?|read(?:ing)?\s+(?:online|original)|original\s+novel|font\s+size|night\s+mode|dark\s+mode|reading\s+settings|join\s+(?:our\s+)?discord|cookie(?:\s+policy)?|privacy\s+policy|terms\s+of\s+(?:use|service)|you\s+are\s+reading|\d+\s*comments?|novel|web|mtl|raw|font|machine\s+translation|ai\s+translation)$/i;

const NAV_WORD =
  /^(?:home|novels?|library|ranking|menu|search|login|sign|in|up|register|bookmark|comments?|share|report|donate|next|previous|prev|toc|index|settings|discord|reddit|facebook|twitter|instagram|cookie|privacy|terms|about|contact|faq|download|app|web|wtr|lab|chapter|chapters)$/i;

const INLINE_JUNK = [
  /wtr[\s-]*lab(?:\s*novel)?/gi,
  /#\s*\d+\s*chapters?/gi,
  /ch\.?\s*\d+\s*\/\s*\d+/gi,
  /chapter\s+\d+\s*\/\s*\d+/gi,
  /\d{1,3}(?:\.\d+)?\s*%\s*web/gi,
  /(?:next|previous|prev)\s+chapter/gi,
  /table\s+of\s+contents/gi,
  /translator(?:'s)?\s+notes?/gi,
  /join\s+our\s+discord/gi,
  /you\s+are\s+reading/gi,
  /read(?:ing)?\s+settings/gi,
];

function isNavBlob(line: string): boolean {
  if (line.length > 96) return false;
  const parts = line.split(/[\s|·•,/|>\-–—:]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 16) return false;
  return parts.every((part) => NAV_WORD.test(part) || /^\d+(?:\.\d+)?%?$/.test(part));
}

export function sanitizeNovelText(raw: string): string {
  let text = raw
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n");
  for (const rule of INLINE_JUNK) text = text.replace(rule, " ");
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const clean = line.replace(/[ \t]+/g, " ").trim();
    if (!clean) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (JUNK_LINE.test(clean) || isNavBlob(clean)) continue;
    if (clean.length < 64 && /wtr[\s-]*lab|next chapter|previous chapter|%\s*web|#\s*\d+\s*chapter/i.test(clean)) continue;
    kept.push(clean);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  const named: [string, string][] = [
    ["nbsp", " "],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["amp", "&"],
  ];
  let text = value;
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
    });
    text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
    });
    for (const [name, ch] of named) {
      text = text.replace(new RegExp("&" + name + ";", "gi"), ch);
    }
  }
  return text;
}

function visibleText(fragment: string): string {
  return decodeEntities(fragment.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">");
  }
}

/** Pull chapter strings out of a script shell before tags are discarded. */
function embeddedChapter(html: string): string {
  const chunks: string[] = [];
  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next?.[1] && next[1].length < 1_500_000) chunks.push(next[1]);
  const pattern = /"(?:content|chapterContent|chapter_content|chapterText|text|body|html|paragraphs)"\s*:\s*"((?:\\.|[^"\\]){80,})"/g;
  for (const match of html.matchAll(pattern)) {
    chunks.push(unescapeJson(match[1]));
    if (chunks.join("").length > 400_000) break;
  }
  return chunks
    .map((chunk) => (chunk.includes("<") ? visibleText(chunk) : decodeEntities(chunk)))
    .filter((chunk) => chunk.length > 80)
    .join("\n\n");
}

function region(html: string): string {
  const marked = html.match(
    /<(?:article|main)[^>]*>[\s\S]*?<\/(?:article|main)>|<[^>]+(?:id|class)=["'][^"']*(?:chapter-content|chapter_content|chapter-body|reading-content|reader-content|novel-content|text-content)[^"']*["'][^>]*>[\s\S]*?(?:<\/div>\s*){1,4}/i,
  );
  return marked?.[0] ?? html;
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = sanitizeNovelText(titleMatch ? visibleText(titleMatch[1]) : "").slice(0, 120);
  const embedded = embeddedChapter(html);
  const stripped = region(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
  const paragraphs = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => visibleText(match[1]))
    .filter((line) => line.length > 12);
  const fromParagraphs = paragraphs.join("\n\n");
  const fallback = visibleText(stripped);
  const merged = [embedded, fromParagraphs.length > fallback.length * 0.4 ? fromParagraphs : fallback]
    .filter(Boolean)
    .join("\n\n");
  return { title, text: sanitizeNovelText(merged) };
}
