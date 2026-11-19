import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  buildDeterministic21Hooks,
  buildDeterministicPackages,
  extractVerticalShortsArc,
  hooksBundleSchema,
  packageBundleSchema,
  shortsArcSchema,
} from "@/lib/studio/hooks";
import {
  compileStoryDeterministic,
  completeStructured,
  deterministicPairedFallback,
  pairedTranslationSchema,
} from "@/lib/studio/provider-router";
import {
  aspectRatioSchema,
  contentModeSchema,
  languageCodeSchema,
  sceneGraphV1Schema,
  styleIdSchema,
  visualModeSchema,
} from "@/lib/studio/schema";

const compileInputSchema = z.object({
  action: z.literal("compile"),
  titleHi: z.string().max(120).default(""),
  titleEn: z.string().max(120).default(""),
  storyText: z.string().min(1).max(30_000),
  mode: contentModeSchema.default("manhwa-anime"),
  aspectRatio: aspectRatioSchema.default("9:16"),
  visualMode: visualModeSchema.default("pure-2d"),
  styleId: styleIdSchema.default("midnight-cyan@1"),
  languages: z.array(languageCodeSchema).min(1).max(2).default(["hi-IN", "en-US"]),
  colabOverrideJson: z.string().optional(),
});

const translateInputSchema = z.object({
  action: z.literal("translate"),
  job: sceneGraphV1Schema,
  colabOverrideJson: z.string().optional(),
});

const hooksInputSchema = z.object({
  action: z.literal("hooks"),
  topic: z.string().min(1).max(4000),
  colabOverrideJson: z.string().optional(),
});

const packageInputSchema = z.object({
  action: z.literal("package"),
  job: sceneGraphV1Schema,
  colabOverrideJson: z.string().optional(),
});

const shortsInputSchema = z.object({
  action: z.literal("shorts"),
  job: sceneGraphV1Schema,
  colabOverrideJson: z.string().optional(),
});

const requestSchema = z.discriminatedUnion("action", [
  compileInputSchema,
  translateInputSchema,
  hooksInputSchema,
  packageInputSchema,
  shortsInputSchema,
]);

export const Route = createFileRoute("/api/2d/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = requestSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "Validation failed", issues: parsed.error.issues },
            { status: 400 },
          );
        }

        const payload = parsed.data;
        if (payload.action === "compile") {
          const fallback = () =>
            compileStoryDeterministic({
              titleHi: payload.titleHi,
              titleEn: payload.titleEn,
              storyText: payload.storyText,
              mode: payload.mode,
              aspectRatio: payload.aspectRatio,
              visualMode: payload.visualMode,
              styleId: payload.styleId,
              languages: payload.languages,
            });
          const result = await completeStructured({
            task: "compile",
            schema: sceneGraphV1Schema,
            systemPrompt:
              "You are a deterministic 2D story director. Output strict JSON matching schema_version aether.2d.job@1 with paired hi-IN and en-US narration lines and template_id from hook-card@1, manhwa-dialogue@1, action-pan@1, cause-effect@1, comparison@1, recap-payoff@1.",
            userPrompt: `Title EN: ${payload.titleEn}\nTitle HI: ${payload.titleHi}\nMode: ${payload.mode}\nAspect: ${payload.aspectRatio}\nStyle: ${payload.styleId}\nStory:\n${payload.storyText.slice(0, 6000)}`,
            localFallback: fallback,
            colabOverrideJson: payload.colabOverrideJson,
          });
          return Response.json({ ok: true, ...result });
        }

        if (payload.action === "translate") {
          const fallback = () => deterministicPairedFallback(payload.job.project.scenes);
          const scenePrompt = payload.job.project.scenes
            .map((s) => `${s.id}: HI="${s.narration["hi-IN"]}" | EN="${s.narration["en-US"]}"`)
            .join("\n");
          const result = await completeStructured({
            task: "translate",
            schema: pairedTranslationSchema,
            systemPrompt:
              'Translate and synchronize each scene into natural Hindi (Devanagari) and English preserving exact scene ids. Return JSON {"scenes":[{"id":"...","hi_IN":"...","en_US":"...","headline_hi":"...","headline_en":"..."}]}.',
            userPrompt: scenePrompt,
            localFallback: fallback,
            colabOverrideJson: payload.colabOverrideJson,
          });
          return Response.json({ ok: true, ...result });
        }

        if (payload.action === "hooks") {
          const fallback = () => buildDeterministic21Hooks(payload.topic);
          const result = await completeStructured({
            task: "hooks",
            schema: hooksBundleSchema,
            systemPrompt:
              "Generate 21 YouTube opening hooks across curiosity, contrast, stake, visual-pattern in both English and Hindi, shortlisting top 5 IDs with concise heuristic rationale (no percentages). Return valid JSON.",
            userPrompt: `Topic: ${payload.topic}`,
            localFallback: fallback,
            colabOverrideJson: payload.colabOverrideJson,
          });
          return Response.json({ ok: true, ...result });
        }

        if (payload.action === "package") {
          const fallback = () => buildDeterministicPackages(payload.job);
          const result = await completeStructured({
            task: "package",
            schema: packageBundleSchema,
            systemPrompt:
              "Generate 3 synchronized YouTube packaging concepts (title_en, title_hi, description_en, description_hi, tags, thumbnail_headline_en, thumbnail_headline_hi, thumbnail_accent). Return strict JSON.",
            userPrompt: `Title: ${payload.job.project.title["en-US"]} / ${payload.job.project.title["hi-IN"]}`,
            localFallback: fallback,
            colabOverrideJson: payload.colabOverrideJson,
          });
          return Response.json({ ok: true, ...result });
        }

        const fallback = () => extractVerticalShortsArc(payload.job);
        const result = await completeStructured({
          task: "shorts",
          schema: shortsArcSchema,
          systemPrompt:
            "Extract a 30-60s 9:16 vertical narrative arc with hook and payoff preserving source_scene_id. Return strict JSON.",
          userPrompt: JSON.stringify(
            payload.job.project.scenes.map((s) => ({
              id: s.id,
              en: s.narration["en-US"],
              hi: s.narration["hi-IN"],
            })),
          ),
          localFallback: fallback,
          colabOverrideJson: payload.colabOverrideJson,
        });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
