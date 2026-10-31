import { sanitizeNovelText } from "./extract.ts";
import { DEFAULT_NEGATIVE, detectLanguage, jobPacketV2Schema, voiceFor, type JobPacketV2, type PacketChapter, type PacketScene } from "./schema.ts";

export type OutfitChange = { chapter: number; outfit: string };

export type Character = {
  id: string;
  name: string;
  soul: string;
  vessel: string;
  look: string;
  face?: string;
  hair?: string;
  age?: string;
  scars?: string;
  eyes?: string;
  body?: string;
  outfit?: string;
  outfits?: OutfitChange[];
  /** First accepted panel that shows this face. A language switch must not clear it. */
  faceUrl?: string;
};

export type Scene = {
  id: string;
  caption: string;
  dialogue: string;
  speaker: string;
  sfx: string;
  state: string;
  imagePrompt: string;
  imageUrl: string | null;
  /** Spoken script kept per language. A language switch reads these and must not redraw. */
  lineEn?: string;
  lineHi?: string;
  captionEn?: string;
  captionHi?: string;
  dialogueEn?: string;
  dialogueHi?: string;
  checkNote?: string;
  retries?: number;
  /** Source panel from a picture manhua. Paint must skip it. */
  locked?: boolean;
  /** True after the writer has saved an English prompt for this beat alone. */
  promptLocked?: boolean;
  /** Worker URLs. Phone memory is not the copy that survives a refresh. */
  voiceEn?: string;
  voiceHi?: string;
  /** Picture hold saved once. A longer line may extend it. */
  holdSec?: number;
  chapter?: number;
};

/** Spoken line for the bubble. Drops a leading "Name:" so the speaker chip is not printed twice. */
export function dialogueWithoutSpeaker(scene: Pick<Scene, "dialogue" | "speaker">): string {
  const line = scene.dialogue.trim();
  const speaker = scene.speaker.trim();
  if (!line || !speaker) return line;
  const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = line.replace(new RegExp(`^${escaped}\\s*[:\\-—–]\\s*`, "i"), "").trim();
  return stripped || line;
}

export type YoutubePrivacy = "public" | "unlisted" | "private";

export type Seo = {
  title: string;
  description: string;
  tags: string[];
  /** Preview only. Omitted from job packet v2. */
  privacy?: YoutubePrivacy;
  hashtags?: string;
};

export function youtubePrivacy(value: unknown): YoutubePrivacy {
  return value === "public" || value === "unlisted" || value === "private" ? value : "private";
}

export type Chapter = {
  index: number;
  title: string;
  sourceUrl: string | null;
  narration: string;
  characters: Character[];
  scenes: Scene[];
};

export type Project = {
  title: string;
  source: "sample" | "local" | "grok";
  text: string;
  logline: string;
  characters: Character[];
  timeline: string[];
  scenes: Scene[];
  narration: string;
  seo: Seo;
  /** Present after a chapter range is cut. Older saves omit it. */
  chapters?: Chapter[];
  language?: "hi" | "en";
  voice?: string;
  hook?: string;
  aspect?: "16:9" | "9:16";
  localModel?: "gguf" | "airllm" | "fast";
  narrationEn?: string;
  narrationHi?: string;
  seoEn?: Seo;
  seoHi?: Seo;
  /** Chapters read only to lock looks. Never turned into panels. */
  bible?: string;
  readyEn?: boolean;
  readyHi?: boolean;
  /** Hugging Face checkpoint the worker should load. Empty uses the cell default. */
  imageRepo?: string;
};

export const SAMPLE_TEXT = `The Lantern Debt

Rain argued with the lanterns on Old Bridge. Ren wore a torn saffron robe over black, a thin scar on his left cheek, and he would not look at the water.

Ren: The pendant cracked because I paid the wrong debt.

He opened his hands. A pale-green jade glowed, and blood threaded his thumb. The glow remembered a name he had tried to forget.

Across the cedar mist, Shao waited with her spear. Silver hair knotted high, black armor, a calm that made the fog step aside.

Shao: Your soul can cross. That body cannot.

Lightning opened the palace gate. Ren stood in the tearing robe. Shao kept the spear lowered, not kind. Between them the debt finally had a face.`;

const LOOK =
  "young man, half-tied black hair, thin scar on the left cheek, torn saffron-yellow robe over black";

export const SAMPLE: Project = {
  title: "The Lantern Debt",
  source: "sample",
  text: SAMPLE_TEXT,
  logline: "A cracked jade pendant calls in a debt on a rain-soaked bridge, and the body is not allowed to follow the soul.",
  characters: [
    {
      id: "ren",
      name: "Ren",
      soul: "Pays what he owes, even the wrong bill. Refuses to look at the water. The debt stays with him if the body changes.",
      vessel: "Living body on the bridge: torn saffron robe, scar on the left cheek. Shao says this body cannot cross.",
      look: LOOK,
    },
    {
      id: "shao",
      name: "Shao",
      soul: "The boundary. Calm enough to part fog. She will let a soul through and stop the body.",
      vessel: "Silver-white hair in a high knot, black layered armor, long spear. No swap in this chapter.",
      look: "woman, silver-white hair in a high knot, black layered armor, long spear, severe calm face",
    },
  ],
  timeline: [
    "Bridge: rain, lanterns, robe already torn, Ren will not face the water.",
    "Jade: pendant cracked and glowing, blood on the thumb.",
    "Cedar: Shao's vessel unchanged, spear held, fog steps aside.",
    "Gate: lightning, robe tearing harder, spear lowered, souls still in their own vessels.",
  ],
  scenes: [
    {
      id: "s1",
      caption: "Rain argued with the lanterns. Ren would not look at the water.",
      dialogue: "The pendant cracked because I paid the wrong debt.",
      speaker: "Ren",
      sfx: "",
      state: "Torn saffron robe, night rain, scar visible",
      imagePrompt: `Vertical manhua panel, no text. Night rain on a stone bridge, paper lanterns. ${LOOK}. He will not look at the water.`,
      imageUrl: "/panels/01-bridge.jpg",
      captionEn: "Rain argued with the lanterns. Ren would not look at the water.",
      dialogueEn: "The pendant cracked because I paid the wrong debt.",
      captionHi: "बारिश लालटेन से झगड़ रही थी। रेन पानी की तरफ़ नहीं देख रहा था।",
      dialogueHi: "पेंडेंट इसलिए टूटा क्योंकि मैंने गलत क़र्ज़ चुकाया।",
      lineEn: "Rain argued with the lanterns. Ren would not look at the water. The pendant cracked because I paid the wrong debt.",
      lineHi: "बारिश लालटेन से झगड़ रही थी। रेन पानी की तरफ़ नहीं देख रहा था। पेंडेंट इसलिए टूटा क्योंकि मैंने गलत क़र्ज़ चुकाया।",
      locked: true,
    },
    {
      id: "s2",
      caption: "The cracked jade remembered a name he had tried to forget.",
      dialogue: "",
      speaker: "",
      sfx: "CRACK",
      state: "Blood on the thumb, pale-green glow, wet hair",
      imagePrompt: `Vertical manhua close-up, no text. ${LOOK}, cupping a cracked glowing jade pendant, blood on the thumb, rain.`,
      imageUrl: "/panels/02-jade.jpg",
      captionEn: "The cracked jade remembered a name he had tried to forget.",
      dialogueEn: "",
      captionHi: "टूटी हुई जेड ने वह नाम याद किया जिसे वह भुलाना चाहता था।",
      dialogueHi: "",
      lineEn: "The cracked jade remembered a name he had tried to forget.",
      lineHi: "टूटी हुई जेड ने वह नाम याद किया जिसे वह भुलाना चाहता था।",
      locked: true,
    },
    {
      id: "s3",
      caption: "Across the cedar mist, Shao waited. Her calm made the fog step aside.",
      dialogue: "Your soul can cross. That body cannot.",
      speaker: "Shao",
      sfx: "",
      state: "Dawn fog, spear diagonal, silver hair knotted high",
      imagePrompt:
        "Vertical manhua panel, no text. Misty cedar forest at dawn. Woman with silver-white hair in a high knot, black armor, long spear, severe calm face.",
      imageUrl: "/panels/03-spear.jpg",
      captionEn: "Across the cedar mist, Shao waited. Her calm made the fog step aside.",
      dialogueEn: "Your soul can cross. That body cannot.",
      captionHi: "देवदार के कोहरे के पार शाओ इंतज़ार कर रही थी। उसके सुकून से कोहरा हट गया।",
      dialogueHi: "तुम्हारी रूह पार हो सकती है। यह शरीर नहीं।",
      lineEn: "Across the cedar mist, Shao waited. Her calm made the fog step aside. Your soul can cross. That body cannot.",
      lineHi: "देवदार के कोहरे के पार शाओ इंतज़ार कर रही थी। उसके सुकून से कोहरा हट गया। तुम्हारी रूह पार हो सकती है। यह शरीर नहीं।",
      locked: true,
    },
    {
      id: "s4",
      caption: "Lightning opened the palace gate. Between them the debt had a face.",
      dialogue: "",
      speaker: "",
      sfx: "CRACK",
      state: "Robe tearing in the wind, spear lowered, lightning over the gate",
      imagePrompt: `Vertical manhua wide panel, no text. Dark palace gate, lightning, rain. Left: ${LOOK}. Right: silver-haired woman in black armor with a spear lowered.`,
      imageUrl: "/panels/04-gate.jpg",
      captionEn: "Lightning opened the palace gate. Between them the debt had a face.",
      dialogueEn: "",
      captionHi: "बिजली ने महल का द्वार खोल दिया। उनके बीच क़र्ज़ का चेहरा था।",
      dialogueHi: "",
      lineEn: "Lightning opened the palace gate. Between them the debt had a face.",
      lineHi: "बिजली ने महल का द्वार खोल दिया। उनके बीच क़र्ज़ का चेहरा था।",
      locked: true,
    },
  ],
  narration:
    "Rain argued with the lanterns on Old Bridge. Ren would not look at the water. The pendant cracked because he paid the wrong debt. Blood threaded his thumb, and the jade remembered a name. In the cedar mist Shao waited with her spear. Your soul can cross, she said. That body cannot. Lightning opened the palace gate, and the debt finally had a face.",
  narrationEn:
    "Rain argued with the lanterns on Old Bridge. Ren would not look at the water. The pendant cracked because he paid the wrong debt. Blood threaded his thumb, and the jade remembered a name. In the cedar mist Shao waited with her spear. Your soul can cross, she said. That body cannot. Lightning opened the palace gate, and the debt finally had a face.",
  narrationHi:
    "पुराने पुल पर बारिश लालटेन से झगड़ रही थी। रेन पानी की तरफ़ नहीं देख रहा था। पेंडेंट इसलिए टूटा क्योंकि उसने गलत क़र्ज़ चुकाया। अंगूठे पर खून था, और जेड ने एक नाम याद किया। देवदार के कोहरे में शाओ भाला लेकर खड़ी थी। उसने कहा, तुम्हारी रूह पार हो सकती है। यह शरीर नहीं। बिजली ने महल का द्वार खोला, और क़र्ज़ का चेहरा सामने था।",
  seo: {
    title: "The Lantern Debt — a soul may cross, the body may not",
    description:
      "Motion comic. On a rain bridge, Ren's cracked jade calls in a debt. Shao lets the soul through and stops the body at the palace gate.",
    tags: ["motion comic", "manhua", "The Lantern Debt", "Ren", "Shao", "original story"],
    hashtags: "#manhua #motioncomic #TheLanternDebt",
    privacy: "private",
  },
  seoEn: {
    title: "The Lantern Debt — a soul may cross, the body may not",
    description:
      "Motion comic. On a rain bridge, Ren's cracked jade calls in a debt. Shao lets the soul through and stops the body at the palace gate.",
    tags: ["motion comic", "manhua", "The Lantern Debt", "Ren", "Shao", "original story"],
    hashtags: "#manhua #motioncomic #TheLanternDebt",
  },
  seoHi: {
    title: "लालटेन का क़र्ज़ — रूह पार हो सकती है, शरीर नहीं",
    description:
      "मोशन कॉमिक। बारिश वाले पुल पर रेन की टूटी जेड एक क़र्ज़ वसूलती है। शाओ रूह को जाने देती है और शरीर को महल के द्वार पर रोक देती है।",
    tags: ["मोशन कॉमिक", "manhua", "लालटेन का क़र्ज़", "Ren", "Shao"],
    hashtags: "#manhua #मोशनकॉमिक #लालटेनकाकर्ज़",
  },
};

const SFX_RULES: [RegExp, string][] = [
  [/lightning|thunder|gate/i, "CRACK"],
  [/spear|blade|slash|sword/i, "SHING"],
  [/crack|shatter|blood|jade/i, "CRACK"],
  [/gasp|whisper|breath/i, "GASP"],
  [/boom|roar|explode/i, "BOOM"],
];

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "figure";
}

function sfxFor(text: string): string {
  for (const [rule, sfx] of SFX_RULES) {
    if (rule.test(text)) return sfx;
  }
  return "";
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function parseBlocks(raw: string): { title: string; blocks: string[] } {
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let title = "Untitled chapter";
  if (lines.length > 1 && lines[0].length <= 48 && !lines[0].includes(":")) {
    title = lines[0];
    lines.shift();
  }
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) blocks.push(buf.join(" "));
    buf = [];
  };
  for (const line of lines) {
    const isSpeaker = /^[^:\n]{1,32}:\s+\S/.test(line);
    if (isSpeaker) {
      flush();
      blocks.push(line);
      continue;
    }
    buf.push(line);
    if (buf.join(" ").length > 320) flush();
  }
  flush();
  return { title, blocks };
}

export function cutChapter(raw: string): Project {
  const incoming = raw.trim();
  if (incoming === SAMPLE_TEXT.trim()) return SAMPLE;
  const text = sanitizeNovelText(incoming);
  if (text === SAMPLE_TEXT.trim()) return SAMPLE;

  const { title, blocks } = parseBlocks(text);
  const speakers = new Map<string, string[]>();
  const scenes: Scene[] = blocks.map((block, index) => {
    const spoken = block.match(/^([^:\n]{1,32}):\s+([\s\S]+)$/);
    const speaker = spoken ? spoken[1].trim() : "";
    const dialogue = spoken ? clip(spoken[2], 180) : "";
    const caption = spoken ? "" : clip(block, 220);
    if (speaker) {
      const list = speakers.get(speaker) ?? [];
      list.push(dialogue);
      speakers.set(speaker, list);
    }
    const blob = `${caption} ${dialogue}`;
    return {
      id: `s${index + 1}`,
      caption: spoken ? "" : clip(block, 220),
      dialogue,
      speaker,
      sfx: sfxFor(blob),
      state: clip(blob, 120),
      imagePrompt: `Vertical illustrated comic panel, no text, no letters, no logos, no speech bubbles. ${clip(blob, 400)}`,
      imageUrl: null,
    };
  });

  const nameHits = speakers.size
    ? []
    : (text.match(/\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?\b/g) ?? []);
  for (const name of nameHits) {
    if (["The", "Rain", "Across", "Between", "Lightning", "Your"].includes(name)) continue;
    if (!speakers.has(name)) speakers.set(name, []);
  }

  const characters: Character[] = [];
  const used = new Set<string>();
  for (const [name, lines] of speakers) {
    if (characters.length >= 24) break;
    let id = slug(name);
    while (used.has(id)) id = `${id}-${used.size}`;
    used.add(id);
    const sentence =
      text
        .split(/(?<=[.!?])\s+/)
        .find((part) => part.includes(name) && /robe|hair|scar|armor|spear|eyes|face|blood/i.test(part)) ?? "";
    const look = sentence ? clip(sentence, 180) : "Body not described in this chapter.";
    characters.push({
      id,
      name,
      soul: lines[0]
        ? `Says: “${clip(lines[0], 140)}” Identity stays on this name if the body changes.`
        : "Named in the chapter. Identity stays on this name if the body changes.",
      vessel: look,
      look,
    });
  }

  if (scenes.length === 0) {
    scenes.push({
      id: "s1",
      caption: "The chapter is empty.",
      dialogue: "",
      speaker: "",
      sfx: "",
      state: "Nothing to track yet",
      imagePrompt: "Vertical empty storyboard panel, no text",
      imageUrl: null,
    });
  }

  const narration = scenes
    .map((scene) => [scene.caption, scene.dialogue].filter(Boolean).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title,
    source: "local",
    text,
    logline: clip(scenes.find((scene) => scene.caption)?.caption || title, 160),
    characters,
    timeline: scenes.map((scene, index) => `Panel ${index + 1}: ${scene.state}`),
    scenes,
    narration: narration || title,
    seo: {
      title: `${title} — motion comic`,
      description: clip(narration || title, 180),
      tags: ["motion comic", "original story", ...characters.map((character) => character.name)].slice(0, 8),
    },
  };
}

export function mergeCuts(parts: Project[]): Project {
  const first = parts[0];
  if (!first) throw new Error("Nothing to merge.");
  const characters: Character[] = [];
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  const timeline: string[] = [];
  for (const part of parts) {
    for (const character of part.characters) {
      const key = character.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      characters.push(character);
    }
    for (const scene of part.scenes) scenes.push({ ...scene, id: `s${scenes.length + 1}` });
    timeline.push(...part.timeline);
  }
  const narration = parts
    .map((part) => part.narration)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const text = parts.map((part) => part.text).join("\n\n");
  return {
    ...first,
    text,
    characters,
    scenes: scenes.length ? scenes : first.scenes,
    timeline,
    narration: narration || first.narration || first.title,
    chapters: undefined,
    language: detectLanguage(`${text}\n${narration}`),
  };
}

export function projectFromChapters(
  items: { index: number; title: string; sourceUrl: string; text: string }[],
): Project {
  if (!items.length) throw new Error("No chapters to cut.");
  const chapters: Chapter[] = [];
  const scenes: Scene[] = [];
  const characters: Character[] = [];
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const item of items) {
    const body = item.text.trim();
    const cut = cutChapter(body);
    const title = (item.title || cut.title || `Chapter ${item.index}`).trim() || `Chapter ${item.index}`;
    const chapterScenes = cut.scenes.map((scene, index) => ({ ...scene, id: `s${index + 1}` }));
    chapters.push({
      index: item.index,
      title,
      sourceUrl: item.sourceUrl,
      narration: cut.narration,
      characters: cut.characters,
      scenes: chapterScenes,
    });
    for (const scene of chapterScenes) scenes.push({ ...scene, id: `c${item.index}-${scene.id}`, chapter: item.index });
    for (const character of cut.characters) {
      const key = character.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      characters.push(character);
    }
    blocks.push(`${title}\n\n${body}`);
  }
  const text = blocks.join("\n\n");
  const narration = chapters
    .map((chapter) => chapter.narration)
    .filter(Boolean)
    .join("\n\n");
  const title = chapters.length === 1 ? chapters[0].title : `${chapters[0].title} · ${chapters.length} chapters`;
  return {
    title,
    source: "local",
    text,
    logline: clip(chapters[0].scenes.find((scene) => scene.caption)?.caption || title, 160),
    characters,
    timeline: scenes.map((scene, index) => `Panel ${index + 1}: ${scene.state}`),
    scenes,
    narration: narration || title,
    seo: {
      title: `${title} — motion comic`,
      description: clip(narration || title, 180),
      tags: ["motion comic", "original story", ...characters.map((character) => character.name)].slice(0, 8),
    },
    chapters,
    language: detectLanguage(text),
  };
}

export type JobPacket = JobPacketV2;

function tilesFor(scene: Scene, characters: Character[]): PacketScene["tiles"] {
  const blob = `${scene.speaker}\n${scene.caption}\n${scene.dialogue}\n${scene.state}`;
  const named = characters.filter((character) => blob.includes(character.name));
  const speaker = characters.find((character) => character.name === scene.speaker);
  const ids = named.map((character) => character.id);
  const prompt =
    scene.imagePrompt.trim() ||
    `Vertical illustrated comic panel, no text, no letters. ${scene.caption || scene.dialogue || scene.state || "Open panel"}`;
  return [
    {
      prompt,
      negative: DEFAULT_NEGATIVE,
      characters: ids,
      vessel_id: speaker?.id ?? ids[0] ?? "",
    },
  ];
}

function faceReference(scene: Scene, characters: Character[]): string | undefined {
  const blob = `${scene.speaker}\n${scene.caption}\n${scene.dialogue}\n${scene.imagePrompt}`;
  const named = characters.find((character) => character.faceUrl && character.name && blob.includes(character.name));
  const only = characters.length === 1 ? characters[0] : undefined;
  const face = named?.faceUrl || only?.faceUrl || "";
  if (!face || face.length > 400_000) return undefined;
  return face;
}

function scenePacket(scene: Scene, characters: Character[]): PacketScene {
  const image = scene.imageUrl && scene.imageUrl.length > 0 && scene.imageUrl.length <= 1_200_000 ? scene.imageUrl : undefined;
  const reference = faceReference(scene, characters);
  return {
    id: scene.id,
    caption: scene.caption,
    sfx: scene.sfx,
    state: scene.state,
    bubble: { speaker: scene.speaker, text: scene.dialogue },
    ...(image ? { image_url: image } : {}),
    ...(scene.holdSec && scene.holdSec > 0 ? { hold_sec: scene.holdSec } : {}),
    ...(reference ? { reference } : {}),
    tiles: tilesFor(scene, characters),
  };
}

function chapterPacket(chapter: Chapter): PacketChapter {
  return {
    index: chapter.index,
    title: chapter.title.trim() || `Chapter ${chapter.index}`,
    source_url: chapter.sourceUrl,
    narration: chapter.narration,
    characters: chapter.characters.map(({ id, name, soul, vessel }) => ({
      id,
      name,
      soul,
      vessel,
      vessel_id: id,
    })),
    scenes: chapter.scenes.map((scene) => scenePacket(scene, chapter.characters)),
  };
}

export function projectWithAbsoluteArt(project: Project, origin: string): Project {
  const fix = (url: string | null): string | null => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
    if (url.startsWith("/") && /^https?:\/\//i.test(origin)) return `${origin.replace(/\/$/, "")}${url}`;
    return url;
  };
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({ ...scene, imageUrl: fix(scene.imageUrl) })),
    chapters: project.chapters?.map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => ({ ...scene, imageUrl: fix(scene.imageUrl) })),
    })),
  };
}

export function jobPacket(project: Project, pass: "assemble" | "revoice" = "assemble"): JobPacket {
  const language = project.language ?? detectLanguage(`${project.text}\n${project.narration}`);
  const chapters: PacketChapter[] = project.chapters?.length
    ? project.chapters.map(chapterPacket)
    : [
        chapterPacket({
          index: 1,
          title: project.title,
          sourceUrl: null,
          narration: project.narration,
          characters: project.characters,
          scenes: project.scenes,
        }),
      ];
  return jobPacketV2Schema.parse({
    version: 2,
    language,
    voice: voiceFor(language),
    title: project.title.trim() || "Untitled chapter",
    aspect: project.aspect === "9:16" ? "9:16" : "16:9",
    local_model: project.localModel === "airllm" || project.localModel === "fast" ? project.localModel : "gguf",
    hook: project.hook ?? "",
    pass,
    chapters,
    seo: {
      title: project.seo.title,
      description: project.seo.description,
      tags: project.seo.tags,
    },
    ...(project.imageRepo?.trim() ? { image_repo: project.imageRepo.trim().slice(0, 200) } : {}),
    note: "Job packet v2. Explanation video. Do not fetch paywalled pages. Panels are prompts for the GPU render, not a static strip.",
  });
}

/** Picture holds and worker voice paths from a finished job. Does not touch prompts or images. */
export function applyWorkerAssets(
  project: Project,
  timing: Record<string, number>,
  voices: Record<string, string>,
  language: "en" | "hi",
): Project {
  return {
    ...project,
    scenes: project.scenes.map((scene) => {
      const hold = timing[scene.id];
      const voice = voices[scene.id];
      const nextHold = hold && hold > 0 ? Math.max(scene.holdSec || 0, hold) : scene.holdSec;
      if (language === "hi") {
        return { ...scene, ...(nextHold ? { holdSec: nextHold } : {}), ...(voice ? { voiceHi: voice } : {}) };
      }
      return { ...scene, ...(nextHold ? { holdSec: nextHold } : {}), ...(voice ? { voiceEn: voice } : {}) };
    }),
  };
}

export { FACTORY_CELL } from "./factory-cell.ts";
