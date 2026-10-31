/** Fixed paint/voice model ids. Chat models are chosen in Settings and are not stored. */
export const studioConfig = {
  /** xAI / Grok endpoints are not called. This flag stays off. */
  xaiEnabled: false,
  geminiModel: "gemini-2.5-flash",
  geminiImageModel: "gemini-2.5-flash-image",
} as const;
