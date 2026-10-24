import type { Project, Scene, Seo } from "./model.ts";

export type ReelLanguage = "en" | "hi";

export type ScriptSlot = { caption: string; dialogue: string };

function slot(scene: Scene, language: ReelLanguage): ScriptSlot | null {
  const caption = language === "hi" ? scene.captionHi : scene.captionEn;
  const dialogue = language === "hi" ? scene.dialogueHi : scene.dialogueEn;
  if (caption === undefined && dialogue === undefined) return null;
  return { caption: caption ?? "", dialogue: dialogue ?? "" };
}

export function voiceLine(scene: Scene, language: ReelLanguage): string {
  const stored = language === "hi" ? scene.lineHi : scene.lineEn;
  if (stored?.trim()) return stored.trim();
  const packed = slot(scene, language);
  if (packed && (packed.caption.trim() || packed.dialogue.trim())) {
    return [packed.caption, packed.dialogue].filter(Boolean).join(" ").trim();
  }
  const otherStored = language === "hi" ? scene.lineEn : scene.lineHi;
  const otherSlot = slot(scene, language === "hi" ? "en" : "hi");
  const otherExists = Boolean(otherStored?.trim() || (otherSlot && (otherSlot.caption.trim() || otherSlot.dialogue.trim())));
  if (otherExists) return "";
  return [scene.caption, scene.dialogue].filter(Boolean).join(" ").trim();
}

export function missingScript(project: Project, language: ReelLanguage): string[] {
  return project.scenes.filter((scene) => !voiceLine(scene, language)).map((scene) => scene.id);
}

/** Copy the stored script into the visible fields. Image URL and image prompt are copied through unchanged. */
export function withLanguage(project: Project, language: ReelLanguage): Project {
  const scenes = project.scenes.map((scene) => {
    const packed = slot(scene, language);
    if (!packed) return scene;
    return {
      ...scene,
      caption: packed.caption,
      dialogue: packed.dialogue,
      imageUrl: scene.imageUrl,
      imagePrompt: scene.imagePrompt,
    };
  });
  const narration = language === "hi" ? project.narrationHi : project.narrationEn;
  const seoPack = language === "hi" ? project.seoHi : project.seoEn;
  const seo: Seo = seoPack
    ? { ...seoPack, privacy: project.seo.privacy }
    : project.seo;
  return {
    ...project,
    language,
    scenes,
    narration: narration?.trim() || scenes.map((scene) => voiceLine(scene, language)).filter(Boolean).join(" "),
    seo,
  };
}

/** Remember the visible script under the language that produced it. Does not clear the other language or any image. */
export function rememberScript(project: Project, language: ReelLanguage): Project {
  const scenes = project.scenes.map((scene) => {
    const line = [scene.caption, scene.dialogue].filter(Boolean).join(" ").trim();
    if (language === "hi") {
      return {
        ...scene,
        captionHi: scene.caption,
        dialogueHi: scene.dialogue,
        lineHi: scene.lineHi?.trim() || line,
      };
    }
    return {
      ...scene,
      captionEn: scene.caption,
      dialogueEn: scene.dialogue,
      lineEn: scene.lineEn?.trim() || line,
    };
  });
  if (language === "hi") {
    return {
      ...project,
      scenes,
      narrationHi: project.narration,
      seoHi: { ...project.seo, privacy: undefined },
    };
  }
  return {
    ...project,
    scenes,
    narrationEn: project.narration,
    seoEn: { ...project.seo, privacy: undefined },
  };
}

export function writeTranslated(
  project: Project,
  language: ReelLanguage,
  lines: { id: string; caption: string; dialogue: string }[],
): Project {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const scenes = project.scenes.map((scene) => {
    const next = byId.get(scene.id);
    if (!next) return scene;
    const line = [next.caption, next.dialogue].filter(Boolean).join(" ").trim();
    if (language === "hi") {
      return { ...scene, captionHi: next.caption, dialogueHi: next.dialogue, lineHi: line };
    }
    return { ...scene, captionEn: next.caption, dialogueEn: next.dialogue, lineEn: line };
  });
  return { ...project, scenes };
}

const LOOK_HINT =
  /hair|robe|scar|eye|armor|face|beard|cloak|dress|outfit|sleeve|boots|blood|skin|brow|knot|spear|sword|pendant|jade/i;

/** Pull appearance sentences from chapters outside the cut. Not a panel list. */
export function gleanLooks(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24 && sentence.length < 280 && LOOK_HINT.test(sentence));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
    if (unique.length >= 14) break;
  }
  return unique.join(" ");
}

export function srtStamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(whole)},${pad(millis, 3)}`;
}

/** Caption file for the active language. Timing follows the line length. Pictures are not involved. */
export function srtFor(project: Project, language: ReelLanguage): string {
  let cursor = 0;
  return project.scenes
    .map((scene, index) => {
      const text = voiceLine(scene, language) || " ";
      const hold = scene.holdSec && scene.holdSec > 0 ? scene.holdSec : Math.min(18, Math.max(1.6, text.length / 14));
      const start = cursor;
      cursor += hold;
      return `${index + 1}\n${srtStamp(start)} --> ${srtStamp(cursor)}\n${text}\n`;
    })
    .join("\n");
}

export function samePictures(before: Project, after: Project): boolean {
  if (before.scenes.length !== after.scenes.length) return false;
  return before.scenes.every((scene, index) => {
    const next = after.scenes[index];
    return next?.id === scene.id && next.imageUrl === scene.imageUrl && next.imagePrompt === scene.imagePrompt;
  });
}
