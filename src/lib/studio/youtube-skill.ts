/** YouTube Agent Skill: structured /yt-script, /yt-package, and /yt-edit strategy engine. */

import type { Project, Scene, Seo } from "./model.ts";

export type YoutubeSkillCommand = "/yt-script" | "/yt-package" | "/yt-edit";

export type YoutubeHookFormula =
  | "curiosity-gap"
  | "high-stakes-cold-open"
  | "paradox-contrast"
  | "payoff-promise";

export type YoutubeScriptPlan = {
  formula: YoutubeHookFormula;
  coldOpen: string;
  retentionLoops: string[];
  pacingRule: string;
};

export type YoutubePackagePlan = {
  titles: string[];
  thumbnailBrief: string;
  thumbnailOverlay: string;
  seo: Seo;
};

export type EditDecisionEntry = {
  sceneId: string;
  index: number;
  startSec: number;
  endSec: number;
  cutType: "cold-open" | "hard-cut" | "j-cut" | "impact-flash";
  motion: "slow-push" | "pan-tilt" | "impact-shake" | "ken-burns";
  sfx: string;
  captionCue: string;
  duckBgm: boolean;
};

export const YOUTUBE_SKILL_RULES = {
  script: [
    "Open in the first 3 seconds with an active contradiction or irreversible consequence.",
    "Plant a retention loop every 15-25 seconds before resolving the prior tension.",
    "Write spoken lines in crisp 15-25 word beats with zero filler throat-clearing.",
  ],
  package: [
    "Keep titles under 70 characters when possible (hard cap 100), leading with the emotional/conflict hook.",
    "Pair thumbnail visual subject + 2-4 word high-contrast overlay that complements, never repeats, the title.",
    "Include clear searchable tags and hashtags matching the episode language.",
  ],
  edit: [
    "Cut on action or spoken punchline; never hold a static frame without Ken Burns zoom/pan.",
    "Duck BGM to -18dB during speech and spike SFX hits on CRACK/BOOM/SHING cues.",
    "Lock visual continuity across cuts; re-voice only swaps audio and captions.",
  ],
} as const;

export function detectYoutubeCommand(input: string): { command: YoutubeSkillCommand; rest: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\/yt-script|\/yt-package|\/yt-edit)(?:\s+([\s\S]*))?$/i);
  if (!match?.[1]) return null;
  return {
    command: match[1].toLowerCase() as YoutubeSkillCommand,
    rest: (match[2] ?? "").trim(),
  };
}

export function youtubeSkillPrompt(command: YoutubeSkillCommand, language: "en" | "hi"): string {
  const langNote = language === "hi" ? "Respond in Hindi (Devanagari) for narration/titles." : "Respond in English.";
  if (command === "/yt-script") {
    return [
      "You are the YouTube Agent Skill (/yt-script).",
      ...YOUTUBE_SKILL_RULES.script,
      langNote,
      "Produce a 3-second cold open hook, retention loop checkpoints, and tight narration beats.",
    ].join(" ");
  }
  if (command === "/yt-package") {
    return [
      "You are the YouTube Agent Skill (/yt-package).",
      ...YOUTUBE_SKILL_RULES.package,
      langNote,
      "Return 3 high-CTR title options, a thumbnail composition brief, a 2-4 word overlay text, description, tags, and hashtags.",
    ].join(" ");
  }
  return [
    "You are the YouTube Agent Skill (/yt-edit).",
    ...YOUTUBE_SKILL_RULES.edit,
    langNote,
    "Produce a timecoded Edit Decision List (EDL) with cut types, camera motion, SFX triggers, and BGM ducking.",
  ].join(" ");
}

export function buildYoutubeScriptPlan(project: Project): YoutubeScriptPlan {
  const firstScene = project.scenes[0];
  const opener = project.hook?.trim() || project.logline?.trim() || firstScene?.caption || project.title;
  const formula: YoutubeHookFormula = project.scenes.some((s) => Boolean(s.sfx))
    ? "high-stakes-cold-open"
    : "curiosity-gap";
  const retentionLoops: string[] = [];
  for (let i = 0; i < project.scenes.length; i += Math.max(2, Math.floor(project.scenes.length / 4) || 2)) {
    const scene = project.scenes[i];
    if (!scene) continue;
    const cue = [scene.caption, scene.dialogue].filter(Boolean).join(" ").trim();
    if (cue) retentionLoops.push(`Beat ${i + 1}: ${cue.slice(0, 110)}`);
    if (retentionLoops.length >= 4) break;
  }
  return {
    formula,
    coldOpen: opener.slice(0, 240),
    retentionLoops,
    pacingRule: "15-25 words per beat · visual change every 2.5-4.5s",
  };
}

export function buildYoutubePackage(project: Project): YoutubePackagePlan {
  const lead = project.characters[0]?.name || "Protagonist";
  const baseTitle = (project.seo?.title || project.title || "Chapter Recap").trim();
  const isHindi = project.language === "hi";
  const titles = isHindi
    ? [
        baseTitle.slice(0, 100),
        `${project.title} — ${lead} का सबसे बड़ा दांव!`.slice(0, 100),
        `क्या ${lead} यह क़र्ज़ चुका पाएगा? | ${project.title}`.slice(0, 100),
      ]
    : [
        baseTitle.slice(0, 100),
        `${lead} Made One Fatal Mistake — ${project.title}`.slice(0, 100),
        `Why ${lead} Refused To Cross | ${project.title}`.slice(0, 100),
      ];
  const overlay = isHindi ? "अब क्या होगा?" : "ONE FATAL DEBT";
  const visualFocus = project.scenes[0]?.imagePrompt || project.logline || project.title;
  return {
    titles,
    thumbnailBrief: `High-contrast close-up featuring ${lead}. Scene: ${visualFocus.slice(0, 180)}`,
    thumbnailOverlay: overlay,
    seo: {
      title: titles[0] || baseTitle.slice(0, 100),
      description: project.seo?.description || project.logline || project.narration.slice(0, 220),
      tags: project.seo?.tags?.length ? project.seo.tags : ["manhua", "story recap", project.title],
      hashtags: project.seo?.hashtags || "#manhua #recap #aetherstudio",
      privacy: project.seo?.privacy,
    },
  };
}

export function buildEditDecisionList(scenes: Scene[]): EditDecisionEntry[] {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const spoken = [scene.caption, scene.dialogue].filter(Boolean).join(" ").trim();
    const duration = scene.holdSec && scene.holdSec > 0
      ? scene.holdSec
      : Math.min(12, Math.max(2.0, Math.round((spoken.length / 14) * 10) / 10));
    const startSec = Math.round(cursor * 100) / 100;
    cursor += duration;
    const endSec = Math.round(cursor * 100) / 100;
    const hasImpact = /crack|boom|shing/i.test(scene.sfx || "");
    const cutType: EditDecisionEntry["cutType"] =
      index === 0 ? "cold-open" : hasImpact ? "impact-flash" : index % 3 === 0 ? "j-cut" : "hard-cut";
    const motion: EditDecisionEntry["motion"] = hasImpact
      ? "impact-shake"
      : index % 2 === 0
        ? "slow-push"
        : "pan-tilt";
    return {
      sceneId: scene.id,
      index: index + 1,
      startSec,
      endSec,
      cutType,
      motion,
      sfx: scene.sfx || "",
      captionCue: spoken.slice(0, 120),
      duckBgm: spoken.length > 0,
    };
  });
}

export function formatEditDecisionMarkdown(entries: EditDecisionEntry[]): string {
  if (!entries.length) return "No scenes in timeline.";
  return entries
    .map(
      (entry) =>
        `[${entry.startSec.toFixed(1)}s–${entry.endSec.toFixed(1)}s] ${entry.sceneId} · ${entry.cutType} · ${entry.motion}${entry.sfx ? ` · SFX:${entry.sfx}` : ""} — ${entry.captionCue}`,
    )
    .join("\n");
}
