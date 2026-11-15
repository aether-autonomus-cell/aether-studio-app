/** OmniRoute failover model gateway across Gemini, Groq, OpenRouter, Colab Ollama/Worker, and keyless Pollinations. */

import {
  cloudRequest,
  shouldFailover,
  shouldFailoverWorker,
  textFromModel,
  type AiSession,
  type CloudCall,
} from "./ai-router.ts";
import { studioConfig } from "./config.ts";
import { workerEndpoint } from "./worker.ts";

export const POLLINATIONS_ENDPOINT = "https://text.pollinations.ai/openai";
export const POLLINATIONS_MODEL = "openai";

export type GatewayProviderId =
  | "primary"
  | "gemini"
  | "groq"
  | "openrouter"
  | "colab-ollama"
  | "worker"
  | "pollinations";

export type ProviderHealth = {
  id: GatewayProviderId;
  label: string;
  failures: number;
  lastError: string;
  cooldownUntil: number;
  lastSuccessAt: number;
};

export type RouteAttempt = {
  provider: GatewayProviderId;
  ok: boolean;
  status?: number;
  error?: string;
};

export type OmniRouteResult =
  | {
      ok: true;
      text: string;
      via: "cloud" | "local" | "pollinations";
      provider: GatewayProviderId;
      trace: RouteAttempt[];
    }
  | {
      ok: false;
      error: string;
      trace: RouteAttempt[];
    };

const COOLDOWN_MS = 45_000;
const HEALTH = new Map<GatewayProviderId, ProviderHealth>();

const LABELS: Record<GatewayProviderId, string> = {
  primary: "Active Cloud Key",
  gemini: "Google Gemini",
  groq: "Groq LPU",
  openrouter: "OpenRouter",
  "colab-ollama": "Colab Ollama",
  worker: "Colab Worker",
  pollinations: "Pollinations (Keyless)",
};

function ensureEntry(id: GatewayProviderId): ProviderHealth {
  let row = HEALTH.get(id);
  if (!row) {
    row = {
      id,
      label: LABELS[id],
      failures: 0,
      lastError: "",
      cooldownUntil: 0,
      lastSuccessAt: 0,
    };
    HEALTH.set(id, row);
  }
  return row;
}

export function isProviderHealthy(id: GatewayProviderId, now = Date.now()): boolean {
  const row = ensureEntry(id);
  return row.cooldownUntil <= now;
}

export function markProviderHealthy(id: GatewayProviderId, now = Date.now()): void {
  const row = ensureEntry(id);
  row.failures = 0;
  row.lastError = "";
  row.cooldownUntil = 0;
  row.lastSuccessAt = now;
}

export function markProviderUnhealthy(id: GatewayProviderId, error: string, now = Date.now()): void {
  const row = ensureEntry(id);
  row.failures += 1;
  row.lastError = error.slice(0, 180);
  row.cooldownUntil = now + COOLDOWN_MS;
}

export function resetGatewayHealth(): void {
  HEALTH.clear();
}

export function getGatewayTelemetry(): ProviderHealth[] {
  const order: GatewayProviderId[] = [
    "primary",
    "gemini",
    "groq",
    "openrouter",
    "colab-ollama",
    "worker",
    "pollinations",
  ];
  return order.map((id) => ({ ...ensureEntry(id) }));
}

export function buildOmniRouteOrder(session: AiSession): GatewayProviderId[] {
  const hasKey = Boolean(session.apiKey.trim());
  const hasWorker = Boolean(session.workerUrl.trim());
  const sequence: GatewayProviderId[] = [];

  if (session.duty === "worker") {
    if (hasWorker) sequence.push("worker", "colab-ollama");
    if (hasKey) sequence.push("primary");
  } else if (session.duty === "key") {
    if (hasKey) sequence.push("primary");
  } else {
    if (hasKey) sequence.push("primary");
    if (hasWorker) sequence.push("worker", "colab-ollama");
  }

  for (const fallback of ["gemini", "groq", "openrouter"] as const) {
    if (hasKey && session.provider === fallback && !sequence.includes("primary")) {
      sequence.push("primary");
    }
  }
  sequence.push("pollinations");

  const healthy = sequence.filter((id) => isProviderHealthy(id));
  const cooling = sequence.filter((id) => !isProviderHealthy(id));
  return [...healthy, ...cooling];
}

export async function callPollinations(
  system: string,
  user: string,
  jsonMode = false,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(POLLINATIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: POLLINATIONS_MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch {
    return { ok: false, error: "Pollinations keyless endpoint did not answer.", status: 0 };
  }

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Pollinations returned ${res.status}.`, status: res.status };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const text = textFromModel(parsed);
    if (text.trim()) return { ok: true, text };
  } catch {
    if (raw.trim()) return { ok: true, text: raw.trim() };
  }
  return { ok: false, error: "Pollinations returned an empty response.", status: res.status };
}

async function callGeminiProvider(
  call: Extract<CloudCall, { kind: "gemini" }>,
  system: string,
  user: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${call.model || studioConfig.geminiModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": call.apiKey },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      },
    );
  } catch {
    return { ok: false, error: "Gemini did not answer.", status: 0 };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Gemini could not finish that call (${res.status}).`, status: res.status };
  }
  try {
    const body = JSON.parse(raw) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
    if (!text.trim()) return { ok: false, error: "Gemini returned an empty plan.", status: res.status };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "Gemini returned an unreadable response.", status: res.status };
  }
}

async function callOpenAiCompatible(
  call: Extract<CloudCall, { kind: "openai" }>,
  system: string,
  user: string,
  jsonMode: boolean,
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: call.model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch {
    return { ok: false, error: "The cloud model did not answer.", status: 0 };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Cloud model returned ${res.status}.`, status: res.status };
  }
  try {
    const text = textFromModel(JSON.parse(raw));
    if (!text.trim()) return { ok: false, error: "The cloud model returned an empty plan.", status: res.status };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "The cloud model returned an unreadable response.", status: res.status };
  }
}

export type WorkerInvoker = (
  path: "/api/v1/llm" | "/api/v1/direct",
  session: AiSession,
  payload: Record<string, unknown>,
) => Promise<{ ok: true; json: unknown } | { ok: false; error: string; status?: number }>;

async function defaultWorkerInvoke(
  path: "/api/v1/llm" | "/api/v1/direct",
  session: AiSession,
  payload: Record<string, unknown>,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string; status?: number }> {
  let target: URL;
  try {
    target = workerEndpoint(session.workerUrl, path);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid worker URL." };
  }
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Aether-Token": session.workerToken,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "The worker did not answer.", status: 0 };
  }
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, error: "The worker redirected. Nothing was sent.", status: res.status };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `Worker returned ${res.status}.`, status: res.status };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: true, json: raw };
  }
}

export async function routeCompletion(
  session: AiSession,
  system: string,
  user: string,
  options: {
    jsonMode?: boolean;
    workerInvoke?: WorkerInvoker;
    workerPath?: "/api/v1/llm" | "/api/v1/direct";
  } = {},
): Promise<OmniRouteResult> {
  const jsonMode = options.jsonMode ?? true;
  const invokeWorker = options.workerInvoke ?? defaultWorkerInvoke;
  const workerPath = options.workerPath ?? "/api/v1/llm";
  const order = buildOmniRouteOrder(session);
  const trace: RouteAttempt[] = [];

  for (const provider of order) {
    if (provider === "primary") {
      const call = cloudRequest(session);
      if (!call) continue;
      let res = call.kind === "gemini"
        ? await callGeminiProvider(call, system, user)
        : await callOpenAiCompatible(call, system, user, jsonMode);
      if (!res.ok && call.kind === "openai" && jsonMode && res.status !== 0) {
        res = await callOpenAiCompatible(call, system, user, false);
      }
      if (res.ok) {
        markProviderHealthy("primary");
        trace.push({ provider: "primary", ok: true });
        return { ok: true, text: res.text, via: "cloud", provider: "primary", trace };
      }
      markProviderUnhealthy("primary", res.error);
      trace.push({ provider: "primary", ok: false, status: res.status, error: res.error });
      if (!shouldFailover(res.status, res.error)) {
        return { ok: false, error: res.error, trace };
      }
      continue;
    }

    if (provider === "worker" || provider === "colab-ollama") {
      if (!session.workerUrl.trim()) continue;
      const endpointPath = provider === "colab-ollama" ? "/api/v1/direct" : workerPath;
      const res = await invokeWorker(endpointPath, session, {
        system,
        prompt: user,
        model_mode: provider === "colab-ollama" ? "gguf" : session.localModel,
        language: session.language,
      });
      if (res.ok) {
        const text = textFromModel(res.json);
        if (text.trim()) {
          markProviderHealthy(provider);
          trace.push({ provider, ok: true });
          return { ok: true, text, via: "local", provider, trace };
        }
      }
      const errMsg = res.ok ? "Local AI returned an empty script." : res.error;
      const status = res.ok ? 200 : res.status;
      markProviderUnhealthy(provider, errMsg);
      trace.push({ provider, ok: false, status, error: errMsg });
      if (!res.ok && !shouldFailoverWorker(errMsg) && status !== 404 && status !== 500 && status !== 502 && status !== 503 && status !== 0) {
        continue;
      }
      continue;
    }

    if (provider === "pollinations") {
      let res = await callPollinations(system, user, jsonMode);
      if (!res.ok && jsonMode && res.status !== 0) {
        res = await callPollinations(system, user, false);
      }
      if (res.ok) {
        markProviderHealthy("pollinations");
        trace.push({ provider: "pollinations", ok: true });
        return { ok: true, text: res.text, via: "pollinations", provider: "pollinations", trace };
      }
      markProviderUnhealthy("pollinations", res.error);
      trace.push({ provider: "pollinations", ok: false, status: res.status, error: res.error });
    }
  }

  const lastError = trace[trace.length - 1]?.error || "No AI route answered.";
  return { ok: false, error: lastError, trace };
}
