/** Model names live here. API keys never do — those are server env vars only. */
export const studioConfig = {
  /** xAI / Grok endpoints are not called. This flag stays off. */
  xaiEnabled: false,
  geminiModel: "gemini-2.5-flash",
  geminiImageModel: "gemini-2.5-flash-image",
} as const;

export type AiProvider = "gemini" | "worker";
