import type { Project } from "./model.ts";

const KEY = "manhua-factory-project-v1";

/** Project snapshot only. Keys, cookies, and tokens are not fields on Project. */
export function saveProject(project: Project): void {
  if (typeof localStorage === "undefined") return;
  try {
    const scenes = project.scenes.map((scene) => ({
      ...scene,
      imageUrl: scene.imageUrl && scene.imageUrl.startsWith("data:") && scene.imageUrl.length > 80_000 ? null : scene.imageUrl,
      voiceEn: scene.voiceEn?.startsWith("data:") ? undefined : scene.voiceEn,
      voiceHi: scene.voiceHi?.startsWith("data:") ? undefined : scene.voiceHi,
    }));
    const characters = project.characters.map((character) => ({
      ...character,
      faceUrl: character.faceUrl && character.faceUrl.startsWith("data:") && character.faceUrl.length > 180_000 ? undefined : character.faceUrl,
    }));
    const payload = JSON.stringify({ ...project, scenes, characters });
    if (payload.length > 4_500_000) return;
    localStorage.setItem(KEY, payload);
  } catch {
    /* quota or private mode */
  }
}

export function loadProject(): Project | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Project;
    if (!data || typeof data.title !== "string" || !Array.isArray(data.scenes)) return null;
    return data;
  } catch {
    return null;
  }
}
