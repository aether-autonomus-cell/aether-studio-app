import fs from "node:fs";
import path from "node:path";
import { loadSkillsLock } from "./registry.ts";

export type SkillTaskDomain = "story" | "director" | "editing" | "packaging" | "captions";

const TASK_SKILL_MAP: Record<SkillTaskDomain, string[]> = {
  story: ["cinematic.director", "youtube.agent"],
  director: ["cinematic.director", "hyperframes.compose"],
  editing: ["youtube.agent", "hyperframes.compose"],
  packaging: ["youtube.agent"],
  captions: ["hyperframes.compose", "cinematic.director"],
};

const FILE_TASK_FILTER: Record<SkillTaskDomain, (relPath: string) => boolean> = {
  story: (p) =>
    p.endsWith("references/story.md") ||
    p.endsWith("references/voice.md") ||
    p.endsWith("yt-plan/SKILL.md") ||
    p.endsWith("yt-script/SKILL.md"),
  director: (p) =>
    p.endsWith("cinematic-film/SKILL.md") ||
    p.endsWith("references/film.md") ||
    p.endsWith("references/sound.md") ||
    p.endsWith("motion-doctrine/SKILL.md"),
  editing: (p) => p.endsWith("yt-edit/SKILL.md") || p.endsWith("yt-retention/SKILL.md") || p.endsWith("seam-gate.md"),
  packaging: (p) => p.endsWith("yt-package/SKILL.md") || p.endsWith("yt-chapters/SKILL.md") || p.endsWith("yt-shorts/SKILL.md"),
  captions: (p) => p.endsWith("captions-overlay/SKILL.md") || p.endsWith("references/performance.md"),
};

export interface LoadedInstructionChunk {
  skill_id: string;
  spdx_license: string;
  file_path: string;
  excerpt: string;
  total_chars: number;
}

/**
 * Load only licensed (`licence_state === "approved"`), task-relevant instruction files.
 * Never loads CC-BY-NC-4.0 or dev-only skills.
 */
export function loadTaskInstructions(
  domain: SkillTaskDomain,
  maxCharsPerFile = 2400,
): LoadedInstructionChunk[] {
  const lock = loadSkillsLock();
  const root = process.cwd();
  const allowedSkillIds = new Set(TASK_SKILL_MAP[domain]);
  const matcher = FILE_TASK_FILTER[domain];
  const chunks: LoadedInstructionChunk[] = [];

  for (const skill of lock.skills) {
    if (!allowedSkillIds.has(skill.skill_id)) continue;
    if (skill.licence_state !== "approved" || skill.spdx_license.includes("NC")) continue;
    if (skill.initial_status === "dev_only_not_production") continue;

    for (const file of skill.instruction_files) {
      if (!matcher(file.path)) continue;
      const abs = path.join(root, file.path);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, "utf8");
      chunks.push({
        skill_id: skill.skill_id,
        spdx_license: skill.spdx_license,
        file_path: file.path,
        excerpt: text.slice(0, maxCharsPerFile),
        total_chars: text.length,
      });
    }
  }
  return chunks;
}
