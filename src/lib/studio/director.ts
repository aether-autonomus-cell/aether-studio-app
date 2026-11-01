import { composeLook } from "./bible.ts";
import { cutChapter, type Character, type Project, type Scene, type Seo } from "./model.ts";

export type Direction = {
  title: string;
  hook: string;
  logline: string;
  timeline: string[];
  characters: Character[];
  scenes: Scene[];
  narration: string;
  seo: Seo;
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? clip(value, max) : "";
}

function jsonObjects(raw: string): Record<string, unknown>[] {
  const parsedObjects: Record<string, unknown>[] = [];
  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const value: unknown = JSON.parse(raw.slice(start, index + 1));
            if (value && typeof value === "object" && !Array.isArray(value)) {
              parsedObjects.push(value as Record<string, unknown>);
            }
            break;
          } catch {
            break;
          }
        }
      }
    }
  }
  return parsedObjects;
}

export function parseDirection(raw: string): Direction | null {
  const row = jsonObjects(raw).find((candidate) => Array.isArray(candidate.scenes));
  if (!row || !Array.isArray(row.scenes)) return null;
  const characters: Character[] = [];
  const seen = new Set<string>();
  for (const item of (Array.isArray(row.characters) ? row.characters : []).slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const character = item as Record<string, unknown>;
    const name = asText(character.name, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const look = asText(character.look, 280) || asText(character.vessel, 280);
    const next: Character = {
      id: asText(character.id, 32) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      soul: asText(character.soul, 280) || "Identity stays with this name.",
      vessel: asText(character.vessel, 280) || "Body not stated.",
      look,
      face: asText(character.face, 180),
      hair: asText(character.hair, 180),
      age: asText(character.age, 40),
      scars: asText(character.scars, 180),
      eyes: asText(character.eyes, 80),
      body: asText(character.body, 180),
      outfit: asText(character.outfit, 180),
    };
    next.look = composeLook(next) || look;
    next.vessel = next.outfit || next.vessel;
    characters.push(next);
  }

  const scenes: Scene[] = [];
  for (const item of row.scenes) {
    if (!item || typeof item !== "object") continue;
    const scene = item as Record<string, unknown>;
    const caption = asText(scene.caption, 240);
    const dialogue = asText(scene.dialogue, 180);
    if (!caption && !dialogue) continue;
    scenes.push({
      id: `s${scenes.length + 1}`,
      caption,
      dialogue,
      speaker: asText(scene.speaker, 40),
      sfx: asText(scene.sfx, 16).toUpperCase(),
      state: asText(scene.state, 160),
      imagePrompt: "",
      imageUrl: null,
      promptLocked: false,
      chapter:
        typeof scene.chapter === "number" && Number.isInteger(scene.chapter) && scene.chapter > 0
          ? scene.chapter
          : undefined,
    });
    if (scenes.length >= 300) break;
  }
  if (!scenes.length) return null;

  const seoRaw = row.seo && typeof row.seo === "object" ? (row.seo as Record<string, unknown>) : {};
  const tags = Array.isArray(seoRaw.tags) ? seoRaw.tags.filter((tag) => typeof tag === "string").slice(0, 8) : [];
  const title = asText(row.title, 80) || "Untitled chapter";
  const timeline = Array.isArray(row.timeline)
    ? row.timeline.filter((note): note is string => typeof note === "string").slice(0, 300)
    : [];
  return {
    title,
    hook: asText(row.hook, 320),
    logline: asText(row.logline, 200),
    timeline,
    characters,
    scenes,
    narration: asText(row.narration, 20000),
    seo: {
      title: asText(seoRaw.title, 100) || title,
      description: asText(seoRaw.description, 220),
      tags,
    },
  };
}

export function deterministicDirection(raw: string): Direction {
  const project: Project = cutChapter(raw);
  return {
    title: project.title,
    hook: project.logline,
    logline: project.logline,
    timeline: project.timeline,
    characters: project.characters,
    scenes: project.scenes,
    narration: project.narration,
    seo: project.seo,
  };
}
