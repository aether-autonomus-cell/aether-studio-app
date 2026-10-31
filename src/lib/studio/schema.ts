import { z } from "zod";

/** Shared job-packet v2. Later accounts must follow this file and docs/job-packet-v2.md. */
export const PACKET_VERSION = 2 as const;

export const DEFAULT_NEGATIVE =
  "text, letters, logos, watermark, speech bubbles, signature, extra limbs, deformed hands";

export const VOICE_BY_LANGUAGE = {
  hi: "hi-IN-MadhurNeural",
  en: "en-US-ChristopherNeural",
} as const;

export const languageSchema = z.enum(["hi", "en"]);
export type Language = z.infer<typeof languageSchema>;

export const tileSchema = z.object({
  prompt: z.string().min(1),
  negative: z.string(),
  characters: z.array(z.string()),
  vessel_id: z.string(),
});

export const bubbleSchema = z.object({
  speaker: z.string(),
  text: z.string(),
});

export const packetSceneSchema = z.object({
  id: z.string().min(1),
  caption: z.string(),
  sfx: z.string(),
  state: z.string(),
  bubble: bubbleSchema,
  image_url: z.string().max(1_200_000).optional(),
  /** Language-neutral picture hold from the first assemble. A longer line may extend it. */
  hold_sec: z.number().positive().max(180).optional(),
  /** Approved face file. The worker may use it. A language switch does not replace it. */
  reference: z.string().max(500_000).optional(),
  tiles: z.array(tileSchema).min(1),
});

export const packetCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  soul: z.string(),
  vessel: z.string(),
  vessel_id: z.string(),
});

export const chapterSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().min(1),
  source_url: z.string().nullable(),
  narration: z.string(),
  characters: z.array(packetCharacterSchema),
  scenes: z.array(packetSceneSchema).min(1),
});

export const seoSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
});

export const jobPacketV2Schema = z.object({
  version: z.literal(PACKET_VERSION),
  language: languageSchema,
  voice: z.string().min(1),
  title: z.string().min(1),
  aspect: z.enum(["16:9", "9:16"]).default("16:9"),
  local_model: z.enum(["gguf", "airllm", "fast"]).default("gguf"),
  hook: z.string().default(""),
  /** assemble draws missing art. revoice keeps every picture and only replaces audio and captions. */
  pass: z.enum(["assemble", "revoice"]).default("assemble"),
  chapters: z.array(chapterSchema).min(1),
  seo: seoSchema,
  /** Hugging Face repo for the Colab checkpoint. Empty keeps the cell default. */
  image_repo: z.string().max(200).optional(),
  note: z.string(),
});

export type JobPacketV2 = z.infer<typeof jobPacketV2Schema>;
export type PacketChapter = z.infer<typeof chapterSchema>;
export type PacketScene = z.infer<typeof packetSceneSchema>;
export type PacketTile = z.infer<typeof tileSchema>;
export type PacketCharacter = z.infer<typeof packetCharacterSchema>;

export function detectLanguage(text: string): Language {
  return /[\u0900-\u097F]/.test(text) ? "hi" : "en";
}

export function voiceFor(language: Language): string {
  return VOICE_BY_LANGUAGE[language];
}
