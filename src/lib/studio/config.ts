/** Fixed model ids. The phone does not ask the user to pick one. A typed Gemini key overrides the server env. */
export const studioConfig = {
  /** xAI / Grok endpoints are not called. This flag stays off. */
  xaiEnabled: false,
  geminiModel: "gemini-2.5-flash",
  geminiImageModel: "gemini-2.5-flash-image",
  /** Male prebuilt voice. Used only when the phone asks Gemini to read. */
  geminiVoice: "Charon",
  geminiTtsModel: "gemini-2.5-flash-preview-tts",
} as const;

export type AiProvider = "gemini" | "worker";
