/** Cloud + local routing. Keys are passed per call and never stored here. */

export const CLOUD_PROVIDERS = [
  "zai",
  "openrouter",
  "github",
  "gemini",
  "groq",
  "openai",
  "deepseek",
  "custom",
] as const;

export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type LocalMode = "gguf" | "airllm" | "fast";
export type ExplainLanguage = "hi" | "en";

export type AiSession = {
  provider: CloudProvider;
  model: string;
  apiKey: string;
  customBaseUrl: string;
  workerUrl: string;
  workerToken: string;
  localModel: LocalMode;
  language: ExplainLanguage;
};

export type ModelOption = { id: string; label: string };

export const PROVIDER_PRESETS: Record<
  CloudProvider,
  { label: string; hint: string; models: ModelOption[]; allowCustomModel: boolean }
> = {
  zai: {
    label: "GLM-5.2 / GLM-4-Flash Free (Z.ai)",
    hint: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-5.2", label: "glm-5.2" },
      { id: "glm-5-turbo", label: "glm-5-turbo" },
      { id: "glm-4-flash", label: "glm-4-flash (free)" },
    ],
    allowCustomModel: false,
  },
  openrouter: {
    label: "OpenRouter Free Tier",
    hint: "https://openrouter.ai/api/v1",
    models: [
      { id: "z-ai/glm-5.2:free", label: "z-ai/glm-5.2:free" },
      { id: "deepseek/deepseek-chat:free", label: "deepseek/deepseek-chat:free" },
      { id: "qwen/qwen-2.5-7b-instruct:free", label: "qwen/qwen-2.5-7b-instruct:free" },
    ],
    allowCustomModel: true,
  },
  github: {
    label: "GitHub Models Free API",
    hint: "https://models.inference.ai.azure.com",
    models: [
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "Meta-Llama-3.1-405B-Instruct", label: "Llama 3.1 405B" },
      { id: "Mistral-large-2411", label: "Mistral Large" },
    ],
    allowCustomModel: true,
  },
  gemini: {
    label: "Google Gemini Free",
    hint: "gemini-2.5-flash",
    models: [{ id: "gemini-2.5-flash", label: "gemini-2.5-flash" }],
    allowCustomModel: false,
  },
  groq: {
    label: "Groq",
    hint: "llama-3.3-70b-versatile",
    models: [{ id: "llama-3.3-70b-versatile", label: "llama-3.3-70b-versatile" }],
    allowCustomModel: true,
  },
  openai: {
    label: "OpenAI",
    hint: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
    ],
    allowCustomModel: true,
  },
  deepseek: {
    label: "DeepSeek",
    hint: "https://api.deepseek.com",
    models: [
      { id: "deepseek-chat", label: "deepseek-chat" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner" },
    ],
    allowCustomModel: false,
  },
  custom: {
    label: "Custom OpenAI-compatible URL",
    hint: "Any /v1 base URL",
    models: [],
    allowCustomModel: true,
  },
};

export const LOCAL_MODES: { id: LocalMode; label: string }[] = [
  { id: "gguf", label: "GLM-5.2 4-Bit GGUF / Distill (Ollama / llama.cpp)" },
  { id: "airllm", label: "GLM-5.2 AirLLM layer-wise (low VRAM)" },
  { id: "fast", label: "Fast local fallback (GLM-4-9B / Qwen2.5-14B)" },
];

export const EXPLAIN_VOICES = {
  hi: "hi-IN-MadhurNeural",
  en: "en-US-ChristopherNeural",
} as const;

const BASES: Record<Exclude<CloudProvider, "gemini" | "custom">, string> = {
  zai: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  github: "https://models.inference.ai.azure.com/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

export function defaultModel(provider: CloudProvider): string {
  return PROVIDER_PRESETS[provider].models[0]?.id ?? "";
}

export function isCloudProvider(value: string): value is CloudProvider {
  return (CLOUD_PROVIDERS as readonly string[]).includes(value);
}

export function isLocalMode(value: string): value is LocalMode {
  return value === "gguf" || value === "airllm" || value === "fast";
}

function clipKey(value: string, max: number): string {
  const key = value.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (key.length > max) throw new Error("That key is too long.");
  return key;
}

export function readSession(input: unknown): AiSession {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawProvider = typeof row.provider === "string" ? row.provider : "";
  let provider: CloudProvider = "zai";
  if (isCloudProvider(rawProvider)) provider = rawProvider;
  else if (rawProvider === "worker") provider = "zai";
  else if (rawProvider === "gemini") provider = "gemini";
  const model = typeof row.model === "string" ? row.model.trim().slice(0, 160) : "";
  const legacyGemini = typeof row.geminiKey === "string" ? row.geminiKey : "";
  const apiKey = clipKey(typeof row.apiKey === "string" ? row.apiKey : legacyGemini, 800);
  const customBaseUrl = typeof row.customBaseUrl === "string" ? row.customBaseUrl.trim().slice(0, 300) : "";
  const workerUrl = typeof row.workerUrl === "string" ? row.workerUrl : "";
  const workerToken = typeof row.workerToken === "string" ? row.workerToken : "";
  if (workerToken.length > 500) throw new Error("That token is too long.");
  const localModel = typeof row.localModel === "string" && isLocalMode(row.localModel) ? row.localModel : "gguf";
  const language: ExplainLanguage = row.language === "hi" ? "hi" : "en";
  if (rawProvider === "worker") {
    return { provider, model: model || defaultModel(provider), apiKey: "", customBaseUrl, workerUrl, workerToken, localModel, language };
  }
  return {
    provider,
    model: model || defaultModel(provider),
    apiKey,
    customBaseUrl,
    workerUrl,
    workerToken,
    localModel,
    language,
  };
}

export type CloudCall =
  | { kind: "gemini"; url: string; apiKey: string; model: string }
  | { kind: "openai"; url: string; model: string; headers: Record<string, string> };

/** Null means there is no cloud key, so the router must use the local worker. */
export function cloudRequest(session: AiSession): CloudCall | null {
  const apiKey = session.apiKey.trim();
  if (!apiKey) return null;
  const model = session.model.trim() || defaultModel(session.provider);
  if (session.provider === "gemini") {
    return {
      kind: "gemini",
      apiKey,
      model: model || "gemini-2.5-flash",
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.5-flash"}:generateContent`,
    };
  }
  let url = "";
  if (session.provider === "custom") {
    const base = session.customBaseUrl.trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(base)) return null;
    url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  } else {
    url = BASES[session.provider];
  }
  if (!model && session.provider === "custom") return null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (session.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aether.studio";
    headers["X-Title"] = "Aether Studio";
  }
  return { kind: "openai", url, model: model || "gpt-4o-mini", headers };
}

/** Any cloud failure shifts to the connected Colab/Kaggle model. A clean 2xx does not. */
export function shouldFailover(status: number, body: string): boolean {
  if (status === 0 || status === 408 || status === 429 || status >= 400) return true;
  return /quota|rate limit|resource exhausted|insufficient|billing|timeout|too many requests/i.test(body);
}

export function textFromModel(json: unknown): string {
  if (typeof json === "string") return json;
  if (!json || typeof json !== "object") return "";
  const row = json as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  if (typeof row.output === "string") return row.output;
  const choices = row.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
    if (typeof choice.text === "string") return choice.text;
  }
  return "";
}

export function directorSystem(language: ExplainLanguage): string {
  const voice = language === "hi"
    ? "Hindi, Devanagari, desi manhua-explanation style, third person. Narrator voice hi-IN-MadhurNeural."
    : "English, dramatic manhua-recap style, third person. Narrator voice en-US-ChristopherNeural.";
  return [
    "You direct a professional manhua explanation video. Return only JSON.",
    `Every title, hook, logline, caption, dialogue, narration, soul, vessel, and seo string must be ${voice}`,
    "If the source is Chinese or any other language, translate it completely into that language. Do not leave Chinese characters in the JSON values.",
    "Keys: title, hook, logline, timeline (string[]), characters ([{id,name,soul,vessel,look}]), scenes ([{caption,dialogue,speaker,sfx,state,imagePrompt}]), narration, seo ({title,description,tags}).",
    "hook is a one or two sentence YouTube cold open.",
    "narration is the full voiceover: hook first, then the chapter in order, third person, no speaker labels, no Chinese.",
    "soul is identity. vessel is the body they wear in this chapter, with visual detail.",
    "Unlimited scenes, one per beat. Never cap at 4 or 6. Do not drop the ending.",
    "imagePrompt is a vertical manhua panel with no text, letters, logos, or speech bubbles.",
    "sfx is one short word or empty. No markdown.",
  ].join(" ");
}
