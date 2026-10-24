import type { Character, Scene } from "./model.ts";

export type OutfitChange = { chapter: number; outfit: string };

const FIELD = /^(face|hair|age|scars|eyes|body|outfit)\s*[:\-]\s*(.+)$/i;

export function outfitAt(changes: OutfitChange[] | undefined, fallback: string, chapter?: number): string {
  if (!chapter || !changes?.length) return fallback.trim();
  let current = fallback.trim();
  const rows = [...changes].filter((row) => row.chapter > 0 && row.outfit.trim()).sort((a, b) => a.chapter - b.chapter);
  for (const row of rows) {
    if (row.chapter <= chapter) current = row.outfit.trim();
  }
  return current;
}

export function composeLook(character: Character, chapter?: number): string {
  const outfit = outfitAt(character.outfits, character.outfit || "", chapter);
  const parts = [
    character.age?.trim(),
    character.body?.trim(),
    character.face?.trim() ? `face: ${character.face.trim()}` : "",
    character.hair?.trim() ? `hair: ${character.hair.trim()}` : "",
    character.eyes?.trim() ? `eyes: ${character.eyes.trim()}` : "",
    character.scars?.trim() ? `scars: ${character.scars.trim()}` : "",
    outfit ? `outfit: ${outfit}` : "",
  ].filter(Boolean);
  if (!parts.length) return character.look.trim();
  const lead = parts.join(", ");
  if (character.look.trim() && !lead.includes(character.look.trim())) return `${lead}. ${character.look.trim()}`;
  return lead;
}

export function bibleDocument(characters: Character[]): string {
  return characters
    .map((character) => {
      const changes = (character.outfits ?? [])
        .filter((row) => row.chapter > 0 && row.outfit.trim())
        .map((row) => `chapter ${row.chapter}: ${row.outfit.trim()}`)
        .join("; ");
      return [
        `${character.name}`,
        `face: ${character.face?.trim() || "—"}`,
        `hair: ${character.hair?.trim() || "—"}`,
        `age: ${character.age?.trim() || "—"}`,
        `scars: ${character.scars?.trim() || "—"}`,
        `eyes: ${character.eyes?.trim() || "—"}`,
        `body: ${character.body?.trim() || "—"}`,
        `outfit: ${character.outfit?.trim() || character.look.trim() || "—"}`,
        changes ? `outfit changes: ${changes}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    })
    .join("\n");
}

export function textToOutfits(value: string): OutfitChange[] {
  const rows: OutfitChange[] = [];
  for (const line of value.split(/\n+/)) {
    const match = line.trim().match(/^(?:chapter\s*)?(\d+)\s*[:\-]\s*(.+)$/i);
    if (!match?.[1] || !match[2]) continue;
    const chapter = Number(match[1]);
    const outfit = match[2].trim();
    if (chapter > 0 && chapter < 100000 && outfit) rows.push({ chapter, outfit: outfit.slice(0, 180) });
  }
  return rows;
}

export function outfitsToText(rows: OutfitChange[] | undefined): string {
  return (rows ?? []).map((row) => `${row.chapter}: ${row.outfit}`).join("\n");
}

export function applyChatLook(character: Character, reply: string): Character {
  const next: Character = { ...character, outfits: character.outfits ? [...character.outfits] : [] };
  let labeled = false;
  for (const line of reply.split(/\n+/)) {
    const match = line.trim().match(FIELD);
    if (!match?.[1] || !match[2]) continue;
    labeled = true;
    const key = match[1].toLowerCase();
    const value = match[2].trim().slice(0, 180);
    if (key === "face") next.face = value;
    if (key === "hair") next.hair = value;
    if (key === "age") next.age = value;
    if (key === "scars") next.scars = value;
    if (key === "eyes") next.eyes = value;
    if (key === "body") next.body = value;
    if (key === "outfit") next.outfit = value;
  }
  if (!labeled) {
    const text = reply.replace(/\s+/g, " ").trim().slice(0, 280);
    next.look = text || next.look;
    if (/robe|armor|dress|cloak|outfit|sleeve|uniform/i.test(text)) next.outfit = text;
    if (/scar/i.test(text)) next.scars = text;
    if (/hair/i.test(text)) next.hair = text;
  }
  next.look = composeLook(next);
  next.vessel = next.outfit || next.look;
  return next;
}

export function beatsNeedingPrompt(scenes: Pick<Scene, "id" | "locked" | "promptLocked">[]): string[] {
  return scenes.filter((scene) => !scene.locked && !scene.promptLocked).map((scene) => scene.id);
}

export function lookLockForScene(
  scene: Pick<Scene, "caption" | "dialogue" | "speaker" | "imagePrompt" | "chapter">,
  characters: Character[],
): string {
  const blob = [scene.caption, scene.dialogue, scene.speaker, scene.imagePrompt].join("\n");
  const named = characters.filter((character) => character.name && blob.includes(character.name));
  const rows = (named.length ? named : characters.slice(0, 4)).map(
    (character) => `${character.name}: ${composeLook(character, scene.chapter)}`,
  );
  return rows.filter((row) => !row.endsWith(": ")).join("\n");
}

export function faceReferenceFor(
  scene: Pick<Scene, "caption" | "dialogue" | "speaker" | "imagePrompt">,
  characters: Character[],
): string {
  const blob = [scene.caption, scene.dialogue, scene.speaker, scene.imagePrompt].join("\n");
  const named = characters.find((character) => character.faceUrl && character.name && blob.includes(character.name));
  if (named?.faceUrl) return named.faceUrl;
  if (characters.length === 1 && characters[0]?.faceUrl) return characters[0].faceUrl;
  return "";
}

export type StudioAction =
  | {
      type: "look";
      name: string;
      face?: string;
      hair?: string;
      age?: string;
      scars?: string;
      eyes?: string;
      body?: string;
      outfit?: string;
      chapter?: number;
    }
  | { type: "line"; id: string; text: string };

const LOOK_KEYS = ["face", "hair", "age", "scars", "eyes", "body", "outfit"] as const;

export function applyLookPatch(character: Character, patch: Omit<Extract<StudioAction, { type: "look" }>, "type" | "name">): Character {
  const next: Character = { ...character, outfits: character.outfits ? [...character.outfits] : [] };
  for (const key of LOOK_KEYS) {
    const value = patch[key]?.trim();
    if (value) next[key] = value.slice(0, 180);
  }
  if (patch.chapter && patch.chapter > 0 && patch.outfit?.trim()) {
    const outfit = patch.outfit.trim().slice(0, 180);
    const outfits = (next.outfits ?? []).filter((row) => row.chapter !== patch.chapter);
    outfits.push({ chapter: patch.chapter, outfit });
    next.outfits = outfits;
    next.outfit = outfit;
  }
  next.look = composeLook(next);
  next.vessel = next.outfit || next.vessel;
  return next;
}

export function parseStudioAction(raw: string): { reply: string; action: StudioAction | null } {
  const match = raw.match(/\n?ACTION\s+(\{[\s\S]*\})\s*$/);
  if (!match?.[1]) return { reply: raw.trim(), action: null };
  const reply = raw.slice(0, match.index).trim();
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { reply: raw.trim(), action: null };
  }
  if (!data || typeof data !== "object") return { reply: raw.trim(), action: null };
  const row = data as Record<string, unknown>;
  if (row.type === "line") {
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 40) : "";
    const text = typeof row.text === "string" ? row.text.trim().slice(0, 400) : "";
    if (!id || !text) return { reply: reply || raw.trim(), action: null };
    return { reply, action: { type: "line", id, text } };
  }
  if (row.type !== "look") return { reply: reply || raw.trim(), action: null };
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
  if (!name) return { reply: reply || raw.trim(), action: null };
  const action: Extract<StudioAction, { type: "look" }> = { type: "look", name };
  for (const key of LOOK_KEYS) {
    if (typeof row[key] === "string" && row[key].trim()) action[key] = row[key].trim().slice(0, 180);
  }
  const chapter = typeof row.chapter === "number" ? Math.floor(row.chapter) : Number(row.chapter);
  if (Number.isFinite(chapter) && chapter > 0 && chapter < 100000) action.chapter = chapter;
  return { reply, action };
}

function grab(sentence: string, rule: RegExp): string {
  return rule.test(sentence) ? sentence.replace(/\s+/g, " ").trim().slice(0, 180) : "";
}

/** Best-effort look lock when the writer is offline. One pass. A language switch must not call this again. */
export function gleanCast(text: string, known: Character[] = []): Character[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20 && sentence.length < 280);
  const names = new Map<string, Character>();
  for (const character of known) {
    names.set(character.name.toLowerCase(), { ...character, outfits: character.outfits ? [...character.outfits] : [] });
  }
  const found = text.match(/\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?\b/g) ?? [];
  for (const name of found) {
    if (["The", "Rain", "Across", "Between", "Lightning", "Your", "Chapter"].includes(name)) continue;
    if (!names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "figure",
        name,
        soul: "Named in the source. Identity stays on this name.",
        vessel: "",
        look: "",
        outfits: [],
      });
    }
  }
  for (const sentence of sentences) {
    const chapter = Number(sentence.match(/chapter\s+(\d+)/i)?.[1] ?? "");
    for (const character of names.values()) {
      if (!sentence.includes(character.name)) continue;
      character.face = character.face || grab(sentence, /face|jaw|brow/i);
      character.hair = character.hair || grab(sentence, /hair/i);
      character.eyes = character.eyes || grab(sentence, /eyes?/i);
      character.scars = character.scars || grab(sentence, /scar/i);
      character.age = character.age || grab(sentence, /\bage\b|young|old|teen/i);
      character.body = character.body || grab(sentence, /tall|slim|body|broad/i);
      const clothes = grab(sentence, /robe|armor|dress|cloak|outfit|sleeve|uniform|boots/i);
      if (clothes && chapter > 0) {
        const outfits = character.outfits ?? [];
        if (!outfits.some((row) => row.chapter === chapter)) outfits.push({ chapter, outfit: clothes });
        character.outfits = outfits;
      } else if (clothes && !character.outfit) {
        character.outfit = clothes;
      }
    }
  }
  return [...names.values()].map((character) => {
    character.look = composeLook(character) || character.look || "Body not described yet.";
    character.vessel = character.outfit || character.look;
    return character;
  });
}

export function mergeCast(base: Character[], extra: Character[]): Character[] {
  const rows = base.map((character) => ({ ...character }));
  for (const character of extra) {
    const key = character.name.trim().toLowerCase();
    const index = rows.findIndex((row) => row.name.trim().toLowerCase() === key);
    if (index < 0) {
      rows.push(character);
      continue;
    }
    const current = rows[index]!;
    rows[index] = {
      ...current,
      face: character.face || current.face,
      hair: character.hair || current.hair,
      age: character.age || current.age,
      scars: character.scars || current.scars,
      eyes: character.eyes || current.eyes,
      body: character.body || current.body,
      outfit: character.outfit || current.outfit,
      outfits: character.outfits?.length ? character.outfits : current.outfits,
      look: character.look || current.look,
      soul: current.soul || character.soul,
      vessel: character.vessel || current.vessel,
      faceUrl: current.faceUrl || character.faceUrl,
    };
  }
  return rows;
}
