import { z } from "zod";
import {
  MAX_SCENES,
  MAX_STORY_CHARS,
  SCHEMA_VERSION,
  VOICE_BY_LANGUAGE,
  type ContentMode,
  type LanguageCode,
  type SceneGraphV1,
  type SceneNode,
  type StyleId,
  type TemplateId,
} from "./schema.ts";

export type AiRouteProvider = "pollinations" | "colab-llm" | "local-deterministic";

export interface FailoverResult<T> {
  data: T;
  route: AiRouteProvider;
  latencyMs: number;
  fallbackReason?: string;
  colabHint?: string;
}

const DEFAULT_POLLINATIONS_URL = "https://text.pollinations.ai/openai";
const REQUEST_TIMEOUT_MS = 20_000;
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const circuit: CircuitState = {
  failures: 0,
  openedAt: null,
};

export function resetCircuitBreaker(): void {
  circuit.failures = 0;
  circuit.openedAt = null;
}

export function getCircuitState(now = Date.now()): {
  open: boolean;
  failures: number;
  cooldownRemainingMs: number;
} {
  if (circuit.openedAt === null) {
    return { open: false, failures: circuit.failures, cooldownRemainingMs: 0 };
  }
  const elapsed = now - circuit.openedAt;
  if (elapsed >= BREAKER_COOLDOWN_MS) {
    circuit.failures = 0;
    circuit.openedAt = null;
    return { open: false, failures: 0, cooldownRemainingMs: 0 };
  }
  return {
    open: true,
    failures: circuit.failures,
    cooldownRemainingMs: BREAKER_COOLDOWN_MS - elapsed,
  };
}

function recordSuccess(): void {
  circuit.failures = 0;
  circuit.openedAt = null;
}

function recordFailure(now = Date.now()): void {
  circuit.failures += 1;
  if (circuit.failures >= BREAKER_FAILURE_THRESHOLD) {
    circuit.openedAt = now;
  }
}

function resolveEndpointUrl(): string {
  const configured =
    typeof process !== "undefined" ? process.env.AETHER_POLLINATIONS_URL?.trim() : undefined;
  return configured || DEFAULT_POLLINATIONS_URL;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1));
    }
    throw new Error("No JSON object found in model output");
  }
}

export async function completeStructured<T>(opts: {
  task: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  localFallback: () => T;
  colabOverrideJson?: string;
  fetchImpl?: typeof fetch;
  disableRemote?: boolean;
}): Promise<FailoverResult<T>> {
  const started = Date.now();

  // Tier 2: Optional user-supplied Colab Local Text Model JSON
  if (opts.colabOverrideJson && opts.colabOverrideJson.trim()) {
    try {
      const parsedJson = extractJsonObject(opts.colabOverrideJson);
      const validated = opts.schema.safeParse(parsedJson);
      if (validated.success) {
        return {
          data: validated.data,
          route: "colab-llm",
          latencyMs: Date.now() - started,
        };
      }
    } catch {
      // Fall through if invalid Colab JSON
    }
  }

  const breaker = getCircuitState();
  if (opts.disableRemote || breaker.open) {
    return {
      data: opts.localFallback(),
      route: "local-deterministic",
      latencyMs: Date.now() - started,
      fallbackReason: breaker.open
        ? `Circuit breaker open (${Math.ceil(breaker.cooldownRemainingMs / 1000)}s remaining)`
        : "Remote disabled",
      colabHint: "Optional: Run the Colab Local LLM cell and paste JSON in Story tab.",
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const endpoint = resolveEndpointUrl();
  let lastReason = "Remote endpoint unavailable";

  // Tier 1: Keyless cloud endpoint with 20s AbortController timeout & 1 retry
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "openai",
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      });
      clearTimeout(timer);

      if (!response.ok) {
        lastReason = `HTTP ${response.status} from keyless endpoint`;
        if (response.status >= 500 && attempt === 0) continue;
        break;
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        lastReason = "Empty response content";
        if (attempt === 0) continue;
        break;
      }

      const rawJson = extractJsonObject(content);
      const validated = opts.schema.safeParse(rawJson);
      if (!validated.success) {
        lastReason = "Schema validation mismatch";
        if (attempt === 0) continue;
        break;
      }

      recordSuccess();
      return {
        data: validated.data,
        route: "pollinations",
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      clearTimeout(timer);
      lastReason =
        err instanceof Error && err.name === "AbortError"
          ? "20s timeout exceeded"
          : String(err instanceof Error ? err.message : err);
      if (attempt === 0) continue;
    }
  }

  recordFailure();

  // Tier 3: Guaranteed instant local deterministic fallback
  return {
    data: opts.localFallback(),
    route: "local-deterministic",
    latencyMs: Date.now() - started,
    fallbackReason: lastReason,
    colabHint: "Optional: Run Colab Local LLM cell to refine narration offline.",
  };
}

/**
 * Deterministic Story-to-SceneGraph compiler (Tier 3 guaranteed fallback).
 * Splits stories up to 30,000 chars into timed beats across all 6 original 2D templates.
 */
export function compileStoryDeterministic(input: {
  titleHi?: string;
  titleEn?: string;
  storyText: string;
  mode: ContentMode;
  aspectRatio: "9:16" | "16:9";
  visualMode: "pure-2d" | "hybrid-2d";
  styleId: StyleId;
  languages: LanguageCode[];
  seed?: number;
  projectId?: string;
  revision?: number;
}): SceneGraphV1 {
  const clipped = input.storyText.slice(0, MAX_STORY_CHARS).trim();
  const rawParagraphs = clipped
    .split(/\n{2,}|(?<=[.!?।])\s+(?=[A-Z\u0904-\u0939\u0958-\u0961])/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Merge ultra-short fragments and cap at MAX_SCENES (120)
  const beats: string[] = [];
  for (const seg of rawParagraphs) {
    if (beats.length > 0 && beats[beats.length - 1].length < 55 && seg.length < 110) {
      beats[beats.length - 1] = `${beats[beats.length - 1]} ${seg}`;
    } else {
      beats.push(seg);
    }
  }
  if (beats.length === 0) {
    beats.push("Every story begins with a single turning point.");
  }

  const boundedBeats = beats.slice(0, MAX_SCENES);
  const templateCycle: TemplateId[] =
    input.mode === "explainer"
      ? ["hook-card@1", "cause-effect@1", "comparison@1", "manhwa-dialogue@1", "recap-payoff@1"]
      : ["hook-card@1", "manhwa-dialogue@1", "action-pan@1", "cause-effect@1", "recap-payoff@1"];

  const moods: ("skyline" | "temple" | "void-grid" | "storm")[] = [
    "skyline",
    "temple",
    "void-grid",
    "storm",
  ];
  const archetypes = ["hero-noir", "mentor-sage", "rival-crimson", "analyst-cyan"] as const;
  const poses = ["determined", "pointing", "stride", "idle"] as const;

  const scenes: SceneNode[] = boundedBeats.map((beat, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === boundedBeats.length - 1 && boundedBeats.length > 1;
    const template_id: TemplateId = isFirst
      ? "hook-card@1"
      : isLast
        ? "recap-payoff@1"
        : templateCycle[idx % templateCycle.length];

    const hasDevanagari = /[\u0900-\u097F]/.test(beat);
    const words = beat.split(/\s+/).filter(Boolean);
    const headlineText = words.slice(0, 4).join(" ").replace(/[.,!?।]+$/, "");
    const estDuration = Math.max(2.6, Math.min(18, Number((beat.length / 13.5 + 0.8).toFixed(1))));

    const hiText = hasDevanagari
      ? beat
      : `दृश्य ${idx + 1}: ${beat}`;
    const enText = hasDevanagari
      ? `Scene ${idx + 1}: ${beat}`
      : beat;

    return {
      id: `s${idx + 1}`,
      template_id,
      narration: {
        "hi-IN": hiText,
        "en-US": enText,
      },
      duration_hint_sec: estDuration,
      pause_after_ms: isLast ? 350 : 280,
      transition: isFirst ? "dissolve" : idx % 3 === 1 ? "wipe" : idx % 3 === 2 ? "slide" : "dissolve",
      props: {
        headline: {
          "hi-IN": hasDevanagari ? headlineText : `भाग ${idx + 1}`,
          "en-US": hasDevanagari ? `Beat ${idx + 1}` : headlineText.toUpperCase(),
        },
        character: {
          archetype: archetypes[idx % archetypes.length],
          pose: isFirst ? "determined" : poses[idx % poses.length],
          gaze: idx % 2 === 0 ? "camera" : "right",
          mouthState: "auto",
          hairFlow: template_id === "action-pan@1" ? 0.9 : 0.6,
        },
        speedLines: {
          enabled: template_id === "action-pan@1" || isFirst,
          intensity: template_id === "action-pan@1" ? 0.62 : 0.35,
          originX: 0.5,
          originY: 0.44,
        },
        panelReveal:
          template_id === "manhwa-dialogue@1"
            ? { layout: "split-diagonal", direction: idx % 2 === 0 ? "left" : "right", borderPx: 3 }
            : undefined,
        backdrop: {
          mood: moods[idx % moods.length],
          scrim: 0.55,
        },
      },
      camera: [
        { at: 0, x: 0.5, y: 0.5, zoom: 1.0, shake: 0 },
        {
          at: 1,
          x: idx % 2 === 0 ? 0.5 : 0.51,
          y: 0.48,
          zoom: template_id === "action-pan@1" ? 1.12 : 1.06,
          shake: template_id === "action-pan@1" ? 0.025 : 0.008,
        },
      ],
    };
  });

  const cleanTitleEn = input.titleEn?.trim() || "Aether 2D Story";
  const cleanTitleHi = input.titleHi?.trim() || cleanTitleEn;

  return {
    schema_version: SCHEMA_VERSION,
    project_id: input.projectId || `aether-${Date.now().toString(36)}`,
    project_revision: input.revision ?? 1,
    project: {
      title: {
        "hi-IN": cleanTitleHi,
        "en-US": cleanTitleEn,
      },
      mode: input.mode,
      visual_mode: input.visualMode,
      languages: input.languages.length ? input.languages : ["hi-IN", "en-US"],
      voices: {
        "hi-IN": VOICE_BY_LANGUAGE["hi-IN"],
        "en-US": VOICE_BY_LANGUAGE["en-US"],
      },
      aspect_ratio: input.aspectRatio,
      resolution: "1080p",
      fps: 30,
      seed: input.seed ?? 42,
      style_id: input.styleId,
      scenes,
      bgm: null,
      outputs: {
        save_to_drive: true,
        drive_folder: "AetherStudioExports",
        captions: ["srt", "vtt"],
      },
      publish_targets: {
        "hi-IN": {
          channel_slot: "hindi",
          title: cleanTitleHi.slice(0, 100),
          description: `${cleanTitleHi}\n\nAether Studio v2.0 2D Dual-Language Export.`,
          tags: ["HindiStory", "2DAnimation", "AetherStudio"],
          privacy_status: "private",
          made_for_kids: false,
        },
        "en-US": {
          channel_slot: "english",
          title: cleanTitleEn.slice(0, 100),
          description: `${cleanTitleEn}\n\nCreated with Aether Studio v2.0.`,
          tags: ["2DAnimation", "Storytelling", "AetherStudio"],
          privacy_status: "private",
          made_for_kids: false,
        },
      },
    },
  };
}

export const pairedTranslationSchema = z.object({
  scenes: z.array(
    z.object({
      id: z.string(),
      hi_IN: z.string(),
      en_US: z.string(),
      headline_hi: z.string().optional(),
      headline_en: z.string().optional(),
    }),
  ),
});

export type PairedTranslationOutput = z.infer<typeof pairedTranslationSchema>;

export function deterministicPairedFallback(scenes: SceneNode[]): PairedTranslationOutput {
  return {
    scenes: scenes.map((s, idx) => {
      const rawHi = s.narration["hi-IN"].trim();
      const rawEn = s.narration["en-US"].trim();
      const hi = rawHi || (rawEn ? `[HI दृश्य ${idx + 1}] ${rawEn}` : `दृश्य ${idx + 1}`);
      const en = rawEn || (rawHi ? `[EN Beat ${idx + 1}] ${rawHi}` : `Scene ${idx + 1}`);
      return {
        id: s.id,
        hi_IN: hi,
        en_US: en,
        headline_hi: s.props?.headline?.["hi-IN"] || `दृश्य ${idx + 1}`,
        headline_en: s.props?.headline?.["en-US"] || `BEAT ${idx + 1}`,
      };
    }),
  };
}
