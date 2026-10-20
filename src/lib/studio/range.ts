/** Safety stop so a mistyped end chapter cannot request thousands of pages. The old 40 cap is gone. */
export const CHAPTER_PULL_CAP = 2000;

export const CHUNK_CHARS = 8000;

export function expandChapterUrls(template: string, start: number, end: number): string[] {
  const raw = template.trim();
  if (!raw) throw new Error("Add a chapter URL.");
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error("Start and end must be whole numbers.");
  }
  if (start < 0 || end < start) throw new Error("The range has to end on or after the start.");
  const count = end - start + 1;
  if (count > CHAPTER_PULL_CAP) {
    throw new Error(`That range is ${count} chapters. Pull at most ${CHAPTER_PULL_CAP} in one go, or narrow the start and end.`);
  }
  const numbers: number[] = [];
  for (let n = start; n <= end; n += 1) numbers.push(n);
  if (raw.includes("{n}")) return numbers.map((n) => raw.replaceAll("{n}", String(n)));
  const matches = raw.match(/\d+/g);
  if (!matches) throw new Error("Put {n} in the URL, or include a chapter number to replace.");
  const last = matches[matches.length - 1];
  const at = raw.lastIndexOf(last);
  return numbers.map((n) => `${raw.slice(0, at)}${n}${raw.slice(at + last.length)}`);
}

export function chunkChapterText(text: string, size = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size * 0.45) cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.45) cut = rest.lastIndexOf(". ", size);
    if (cut < size * 0.45) cut = size;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  if (parts.length > 1 && parts[parts.length - 1].length < 40) {
    const tail = parts.pop();
    if (tail) parts[parts.length - 1] = `${parts[parts.length - 1]}\n\n${tail}`;
  }
  return parts;
}
