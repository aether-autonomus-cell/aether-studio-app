import { sanitizeNovelText } from "./extract.ts";
import { DEFAULT_NEGATIVE, detectLanguage, jobPacketV2Schema, voiceFor, type JobPacketV2, type PacketChapter, type PacketScene } from "./schema.ts";

export type Character = {
  id: string;
  name: string;
  soul: string;
  vessel: string;
  look: string;
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
    },
  ],
  narration:
    "Rain argued with the lanterns on Old Bridge. Ren would not look at the water. The pendant cracked because he paid the wrong debt. Blood threaded his thumb, and the jade remembered a name. In the cedar mist Shao waited with her spear. Your soul can cross, she said. That body cannot. Lightning opened the palace gate, and the debt finally had a face.",
  seo: {
    title: "The Lantern Debt — a soul may cross, the body may not",
    description:
      "Motion comic. On a rain bridge, Ren's cracked jade calls in a debt. Shao lets the soul through and stops the body at the palace gate.",
    tags: ["motion comic", "manhua", "The Lantern Debt", "Ren", "Shao", "original story"],
    privacy: "private",
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
    for (const scene of chapterScenes) scenes.push({ ...scene, id: `c${item.index}-${scene.id}` });
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

function scenePacket(scene: Scene, characters: Character[]): PacketScene {
  return {
    id: scene.id,
    caption: scene.caption,
    sfx: scene.sfx,
    state: scene.state,
    bubble: { speaker: scene.speaker, text: scene.dialogue },
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

export function jobPacket(project: Project): JobPacket {
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
    voice: voiceFor(language, project.voice),
    title: project.title.trim() || "Untitled chapter",
    chapters,
    seo: {
      title: project.seo.title,
      description: project.seo.description,
      tags: project.seo.tags,
    },
    note: "Job packet v2. Text the author supplied. Do not fetch paywalled pages. Bubbles and sfx are composited after the tiles, never painted into them.",
  });
}

export const FACTORY_CELL = `import json, asyncio, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(".")
found = list(ROOT.glob("job.json"))
if Path("/kaggle/input").exists():
    found += list(Path("/kaggle/input").glob("*/job.json"))
if not found:
    raise SystemExit("Upload job.json from Aether Studio (Bay, Copy job packet).")
job = json.loads(found[0].read_text())
out = ROOT / "aether_out"
out.mkdir(exist_ok=True)
W, H = 720, 1080

def font(size):
    path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()

def render(i, scene):
    im = Image.new("RGB", (W, H), (20, 17, 15))
    name = Path(str(scene.get("imageUrl") or "")).name
    local = ROOT / name if name else None
    if local and local.exists():
        art = Image.open(local).convert("RGB")
        art = art.resize((W, H))
        im.paste(art, (0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    sfx = (scene.get("sfx") or "").strip()
    if sfx:
        d.text((36, 40), sfx, font=font(64), fill=(226, 75, 50, 255))
    dialogue = (scene.get("dialogue") or "").strip()
    if dialogue:
        d.rounded_rectangle((36, H - 300, W - 36, H - 96), 28, fill=(243, 234, 219, 235))
        d.text((56, H - 276), (scene.get("speaker") or "")[:32], font=font(22), fill=(158, 38, 22, 255))
        d.text((56, H - 236), dialogue[:160], font=font(28), fill=(20, 17, 15, 255))
    caption = (scene.get("caption") or "").strip()
    if caption:
        d.rectangle((0, H - 80, W, H), fill=(20, 17, 15, 235))
        d.text((24, H - 52), caption[:88], font=font(22), fill=(243, 234, 219, 255))
    path = out / f"panel_{i:02d}.png"
    im.save(path)
    return path

def flatten(packet):
    chapters = packet.get("chapters")
    if isinstance(chapters, list) and chapters:
        rows = []
        notes = []
        for chapter in chapters:
            note = (chapter.get("narration") or "").strip()
            if note:
                notes.append(note)
            for scene in chapter.get("scenes") or []:
                bubble = scene.get("bubble") or {}
                rows.append({
                    "caption": scene.get("caption") or "",
                    "dialogue": bubble.get("text") or scene.get("dialogue") or "",
                    "speaker": bubble.get("speaker") or scene.get("speaker") or "",
                    "sfx": scene.get("sfx") or "",
                    "imageUrl": scene.get("imageUrl") or "",
                })
        return rows, notes
    return packet.get("scenes") or [], [packet.get("narration") or ""]

flat_scenes, chapter_notes = flatten(job)
paths = [render(i, s) for i, s in enumerate(flat_scenes, 1)]
if not paths:
    raise SystemExit("Job packet has no scenes.")
joined = " ".join(note for note in chapter_notes if note).strip()
text = (joined or job.get("narration") or job.get("title") or "Aether")[:4000]
devanagari = any("\\u0900" <= ch <= "\\u097f" for ch in text)
voice_id = (job.get("voice") or "").strip() or ("hi-IN-MadhurNeural" if job.get("language") == "hi" or devanagari else "en-IN-PrabhatNeural")
voice = out / "voice.mp3"
try:
    import edge_tts
    async def speak():
        await edge_tts.Communicate(text, voice_id).save(str(voice))
    asyncio.run(speak())
except Exception as exc:
    raise SystemExit(f"Male voice failed ({voice_id}). Not switching to another voice. {exc}")

trim = out / "voice.trim.mp3"
subprocess.check_call(["ffmpeg", "-y", "-i", str(voice), "-af",
    "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.12:stop_periods=1:stop_threshold=-40dB:stop_silence=0.25",
    str(trim)])
lst = out / "list.txt"
lst.write_text("".join(f"file '{p.resolve()}'\\nduration 4\\n" for p in paths) + f"file '{paths[-1].resolve()}'\\n")
mp4 = out / "aether.mp4"
subprocess.check_call(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-i", str(trim),
    "-vf", "scale=720:1080,format=yuv420p", "-c:v", "libx264", "-c:a", "aac", "-shortest",
    "-movflags", "+faststart", str(mp4)])
print("READY", mp4.resolve())
`;
