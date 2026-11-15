/** Modular video production engines: Manhua Factory, MoneyPrinterTurbo, and Cinematic Skill. */

export type VideoEngineId = "manhua" | "moneyprinter-turbo" | "cinematic-skill";

export type CinematicTemplateId =
  | "kinetic-title"
  | "timeline-card"
  | "data-callout"
  | "chapter-opener";

export type VideoEngineSpec = {
  id: VideoEngineId;
  label: string;
  summary: string;
  supportsSkia: boolean;
  supportsSubtitles: boolean;
};

export const VIDEO_ENGINES: VideoEngineSpec[] = [
  {
    id: "manhua",
    label: "Manhua Panel Factory",
    summary: "Panel art + Ken Burns zoompan + Edge-TTS + ASS/SRT burned captions + ducked BGM.",
    supportsSkia: false,
    supportsSubtitles: true,
  },
  {
    id: "moneyprinter-turbo",
    label: "MoneyPrinterTurbo Pipeline",
    summary: "Script-to-stock/local visual assembly + Edge-TTS + BGM ducking + stylized subtitles.",
    supportsSkia: false,
    supportsSubtitles: true,
  },
  {
    id: "cinematic-skill",
    label: "Cinematic Skill (Skia + Motion)",
    summary: "Programmatic documentary/explainer frames via Python Skia / HTML-CSS motion templates.",
    supportsSkia: true,
    supportsSubtitles: true,
  },
];

export const CINEMATIC_TEMPLATES: { id: CinematicTemplateId; label: string }[] = [
  { id: "chapter-opener", label: "Chapter Opener (Title + Logline)" },
  { id: "kinetic-title", label: "Kinetic Typography Beat" },
  { id: "timeline-card", label: "Timeline / Continuity Card" },
  { id: "data-callout", label: "Documentary Callout Card" },
];

export function isVideoEngine(value: unknown): value is VideoEngineId {
  return value === "manhua" || value === "moneyprinter-turbo" || value === "cinematic-skill";
}

export function isCinematicTemplate(value: unknown): value is CinematicTemplateId {
  return (
    value === "kinetic-title" ||
    value === "timeline-card" ||
    value === "data-callout" ||
    value === "chapter-opener"
  );
}
