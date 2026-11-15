/** GBrain lightweight local knowledge/memory layer for character bibles, scene history, and continuity. */

import { bibleDocument, composeLook } from "./bible.ts";
import type { Character, Scene } from "./model.ts";

const MEMORY_KEY = "aether-gbrain-memory-v1";
const MAX_SCENE_HISTORY = 120;
const MAX_LOGS = 80;

export const GBRAIN_SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS character_bibles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  soul TEXT NOT NULL,
  vessel TEXT NOT NULL,
  look TEXT NOT NULL,
  last_chapter INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scene_history (
  id TEXT PRIMARY KEY,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  scene_count INTEGER NOT NULL,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_logs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`.trim();

export type GBrainCharacterRecord = {
  id: string;
  name: string;
  soul: string;
  vessel: string;
  look: string;
  lastChapter: number;
  updatedAt: number;
};

export type GBrainSceneRecord = {
  id: string;
  chapterIndex: number;
  title: string;
  hook: string;
  sceneCount: number;
  summary: string;
  updatedAt: number;
};

export type GBrainLogEntry = {
  id: string;
  kind: "bible" | "scene" | "route" | "hermes" | "youtube" | "worker";
  summary: string;
  createdAt: number;
};

export type GBrainStore = {
  version: 1;
  characters: Record<string, GBrainCharacterRecord>;
  sceneHistory: GBrainSceneRecord[];
  logs: GBrainLogEntry[];
};

export function createEmptyGBrain(): GBrainStore {
  return {
    version: 1,
    characters: {},
    sceneHistory: [],
    logs: [],
  };
}

export function loadGBrain(): GBrainStore {
  if (typeof localStorage === "undefined") return createEmptyGBrain();
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return createEmptyGBrain();
    const parsed = JSON.parse(raw) as Partial<GBrainStore>;
    if (!parsed || parsed.version !== 1) return createEmptyGBrain();
    return {
      version: 1,
      characters: parsed.characters && typeof parsed.characters === "object" ? parsed.characters : {},
      sceneHistory: Array.isArray(parsed.sceneHistory) ? parsed.sceneHistory : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return createEmptyGBrain();
  }
}

export function saveGBrain(store: GBrainStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload = JSON.stringify(store);
    if (payload.length > 2_000_000) return;
    localStorage.setItem(MEMORY_KEY, payload);
  } catch {
    /* storage quota or private mode */
  }
}

export function clearGBrain(): GBrainStore {
  const empty = createEmptyGBrain();
  saveGBrain(empty);
  return empty;
}

export function appendMemoryLog(
  store: GBrainStore,
  kind: GBrainLogEntry["kind"],
  summary: string,
): GBrainStore {
  const clean = summary.replace(/\s+/g, " ").trim().slice(0, 260);
  if (!clean) return store;
  const entry: GBrainLogEntry = {
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    summary: clean,
    createdAt: Date.now(),
  };
  return {
    ...store,
    logs: [entry, ...store.logs].slice(0, MAX_LOGS),
  };
}

export function upsertCharactersInGBrain(
  store: GBrainStore,
  characters: Character[],
  chapterIndex = 1,
): GBrainStore {
  if (!characters.length) return store;
  const nextChars = { ...store.characters };
  const now = Date.now();
  for (const character of characters) {
    const key = character.name.trim().toLowerCase();
    if (!key) continue;
    const look = composeLook(character, chapterIndex) || character.look || character.vessel;
    nextChars[key] = {
      id: character.id || key.replace(/[^a-z0-9]+/g, "-"),
      name: character.name.trim(),
      soul: character.soul.trim().slice(0, 280),
      vessel: character.vessel.trim().slice(0, 280),
      look: look.trim().slice(0, 320),
      lastChapter: Math.max(nextChars[key]?.lastChapter ?? 0, chapterIndex),
      updatedAt: now,
    };
  }
  return appendMemoryLog(
    { ...store, characters: nextChars },
    "bible",
    `Synced ${characters.length} character bible record(s) at chapter ${chapterIndex}.`,
  );
}

export function recordSceneHistoryInGBrain(
  store: GBrainStore,
  chapterIndex: number,
  title: string,
  scenes: Scene[],
  hook = "",
): GBrainStore {
  if (!scenes.length) return store;
  const firstBeat = [scenes[0]?.caption, scenes[0]?.dialogue].filter(Boolean).join(" ").trim();
  const lastBeat = [scenes[scenes.length - 1]?.caption, scenes[scenes.length - 1]?.dialogue]
    .filter(Boolean)
    .join(" ")
    .trim();
  const summary = [firstBeat, lastBeat].filter(Boolean).join(" -> ").slice(0, 320);
  const record: GBrainSceneRecord = {
    id: `ch-${chapterIndex}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
    chapterIndex,
    title: title.slice(0, 100) || `Chapter ${chapterIndex}`,
    hook: hook.slice(0, 240),
    sceneCount: scenes.length,
    summary,
    updatedAt: Date.now(),
  };
  const filtered = store.sceneHistory.filter((item) => item.id !== record.id);
  return appendMemoryLog(
    { ...store, sceneHistory: [record, ...filtered].slice(0, MAX_SCENE_HISTORY) },
    "scene",
    `Recorded ${record.title} (${scenes.length} beats).`,
  );
}

export function queryContinuityContext(store: GBrainStore, text: string, characters: Character[] = []): string {
  const lower = text.toLowerCase();
  const matchedChars = Object.values(store.characters)
    .filter((entry) => lower.includes(entry.name.toLowerCase()))
    .slice(0, 8);
  const bibleLines = matchedChars.map((entry) => `${entry.name}: ${entry.look || entry.vessel}`);
  if (!bibleLines.length && characters.length) {
    bibleLines.push(bibleDocument(characters.slice(0, 6)));
  }
  const recentScenes = store.sceneHistory
    .slice(0, 3)
    .map((item) => `${item.title} (${item.sceneCount} beats): ${item.summary}`);
  return [
    bibleLines.length ? `Characters:\n${bibleLines.join("\n")}` : "",
    recentScenes.length ? `Recent continuity:\n${recentScenes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1800);
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function exportGBrainSql(store: GBrainStore): string {
  const statements: string[] = [GBRAIN_SQL_SCHEMA];
  for (const ch of Object.values(store.characters)) {
    statements.push(
      `INSERT OR REPLACE INTO character_bibles (id, name, soul, vessel, look, last_chapter, updated_at) VALUES (${sqlQuote(ch.id)}, ${sqlQuote(ch.name)}, ${sqlQuote(ch.soul)}, ${sqlQuote(ch.vessel)}, ${sqlQuote(ch.look)}, ${ch.lastChapter}, ${ch.updatedAt});`,
    );
  }
  for (const sc of store.sceneHistory) {
    statements.push(
      `INSERT OR REPLACE INTO scene_history (id, chapter_index, title, hook, scene_count, summary, updated_at) VALUES (${sqlQuote(sc.id)}, ${sc.chapterIndex}, ${sqlQuote(sc.title)}, ${sqlQuote(sc.hook)}, ${sc.sceneCount}, ${sqlQuote(sc.summary)}, ${sc.updatedAt});`,
    );
  }
  return statements.join("\n");
}
