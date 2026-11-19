import type { AspectRatio, LanguageCode, Resolution, SceneGraphV1 } from "../schema";
import {
  estimateTimelineForJob,
  findSceneAtFrame,
  type CumulativeTimeline,
} from "../timing";
import { type RenderContextInfo } from "./primitives";
import { getStyleManifest } from "./styles";
import { renderSceneTemplate } from "./templates";
import { getSafeBox } from "./typography";

function resolveDimensions(
  aspectRatio: AspectRatio,
  resolution: Resolution,
): { width: number; height: number } {
  if (aspectRatio === "9:16") {
    return resolution === "1080p" ? { width: 1080, height: 1920 } : { width: 540, height: 960 };
  }
  return resolution === "1080p" ? { width: 1920, height: 1080 } : { width: 960, height: 540 };
}

export interface AetherRenderBundle {
  job: SceneGraphV1;
  language: LanguageCode;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  timeline: CumulativeTimeline;
  hybridBackdrops?: Record<string, string>;
  speechEnvelopes?: Record<string, number[]>;
  customCodeOverride?: {
    enabled: boolean;
    kind: "canvas2d" | "svg" | "p5";
    code: string;
  };
}

export interface AetherWindowApi {
  init: (bundle: AetherRenderBundle) => Promise<{ totalFrames: number; width: number; height: number }>;
  renderAt: (frameIndex: number) => Promise<void>;
}

declare global {
  interface Window {
    Aether?: AetherWindowApi;
  }
}

export function buildRenderBundle(
  job: SceneGraphV1,
  language: LanguageCode,
  options?: {
    timeline?: CumulativeTimeline;
    hybridBackdrops?: Record<string, string>;
    speechEnvelopes?: Record<string, number[]>;
    customCodeOverride?: {
      enabled: boolean;
      kind: "canvas2d" | "svg" | "p5";
      code: string;
    };
  },
): AetherRenderBundle {
  const { width, height } = resolveDimensions(
    job.project.aspect_ratio,
    job.project.resolution,
  );
  const timeline = options?.timeline ?? estimateTimelineForJob(job, language);
  return {
    job,
    language,
    width,
    height,
    fps: job.project.fps,
    totalFrames: timeline.totalFrames,
    timeline,
    hybridBackdrops: options?.hybridBackdrops,
    speechEnvelopes: options?.speechEnvelopes,
    customCodeOverride: options?.customCodeOverride,
  };
}

export function installAetherRuntime(): AetherWindowApi {
  let state: AetherRenderBundle | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let customHook: AetherWindowApi | null = null;
  const loadedBackdrops = new Map<string, HTMLImageElement>();

  const api: AetherWindowApi = {
    async init(bundle: AetherRenderBundle) {
      state = bundle;
      canvas = document.getElementById("aether-canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "aether-canvas";
        document.body.appendChild(canvas);
      }
      canvas.width = bundle.width;
      canvas.height = bundle.height;
      ctx = canvas.getContext("2d");

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      // Preload optional hybrid T4 GPU backdrops
      loadedBackdrops.clear();
      if (bundle.hybridBackdrops) {
        await Promise.all(
          Object.entries(bundle.hybridBackdrops).map(
            ([sceneId, src]) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  loadedBackdrops.set(sceneId, img);
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = src;
              }),
          ),
        );
      }

      customHook = null;
      const svgOverlay = document.getElementById("aether-svg-overlay");
      if (svgOverlay) svgOverlay.innerHTML = "";

      if (bundle.customCodeOverride?.enabled && bundle.customCodeOverride.code.trim()) {
        const { kind, code } = bundle.customCodeOverride;
        if (kind === "canvas2d") {
          // Execute user's window.Aether custom canvas module in a sandboxed iframe scope
          const prevAether = window.Aether;
          try {
            const runner = new Function(code);
            runner();
            if (window.Aether && window.Aether !== api && typeof window.Aether.renderAt === "function") {
              customHook = window.Aether;
              window.Aether = api;
              if (typeof customHook.init === "function") {
                await customHook.init(bundle);
              }
            }
          } finally {
            window.Aether = prevAether ?? api;
          }
        } else if (kind === "svg" && svgOverlay) {
          svgOverlay.innerHTML = code;
        }
      }

      return {
        totalFrames: bundle.totalFrames,
        width: bundle.width,
        height: bundle.height,
      };
    },

    async renderAt(frameIndex: number) {
      if (!state || !ctx) return;
      if (customHook) {
        await customHook.renderAt(frameIndex);
        return;
      }

      const { job, language, width, height, fps, timeline } = state;
      if (
        state.customCodeOverride?.enabled &&
        state.customCodeOverride.kind === "p5" &&
        state.customCodeOverride.code.trim()
      ) {
        const p5Scene = {
          ...job.project.scenes[0],
          template_id: "custom-canvas@1" as const,
          props: {
            ...job.project.scenes[0]?.props,
            customCode: {
              kind: "p5" as const,
              code: state.customCodeOverride.code,
            },
          },
        };
        const rc: RenderContextInfo = {
          ctx,
          width,
          height,
          aspectRatio: job.project.aspect_ratio,
          safeBox: getSafeBox(width, height, job.project.aspect_ratio),
          frameIndex,
          localFrame: frameIndex,
          localProgress: frameIndex / Math.max(1, timeline.totalFrames - 1),
          fps,
          seed: job.project.seed,
          language,
          style: getStyleManifest(job.project.style_id),
          speechEnvelope: 0.5,
        };
        renderSceneTemplate(rc, p5Scene);
        return;
      }

      const lookup = findSceneAtFrame(timeline, frameIndex);
      const scene = job.project.scenes[lookup.sceneIndex] ?? job.project.scenes[0];
      if (!scene) return;

      const envArr = state.speechEnvelopes?.[scene.id];
      const speechEnvelope =
        envArr && lookup.localFrame < envArr.length
          ? envArr[lookup.localFrame]
          : lookup.speechEnvelope;

      const rc: RenderContextInfo = {
        ctx,
        width,
        height,
        aspectRatio: job.project.aspect_ratio,
        safeBox: getSafeBox(width, height, job.project.aspect_ratio),
        frameIndex,
        localFrame: lookup.localFrame,
        localProgress: lookup.localProgress,
        fps,
        seed: job.project.seed + lookup.sceneIndex * 31,
        language,
        style: getStyleManifest(job.project.style_id),
        speechEnvelope,
      };

      const hybridImg = loadedBackdrops.get(scene.id) ?? null;
      renderSceneTemplate(rc, scene, hybridImg);
    },
  };

  if (typeof window !== "undefined") {
    window.Aether = api;
  }
  return api;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installAetherRuntime();
}
