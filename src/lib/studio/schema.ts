import { z } from "zod";

export const SCHEMA_VERSION = "aether.2d.job@1" as const;
export const MAX_STORY_CHARS = 30_000;
export const MAX_SCENES = 120;
export const MAX_DURATION_SEC = 600;

export const languageCodeSchema = z.enum(["hi-IN", "en-US"]);
export type LanguageCode = z.infer<typeof languageCodeSchema>;

export const VOICE_BY_LANGUAGE: Record<LanguageCode, string> = {
  "hi-IN": "hi-IN-MadhurNeural",
  "en-US": "en-US-ChristopherNeural",
};

export const contentModeSchema = z.enum(["story", "explainer", "manhwa-anime"]);
export type ContentMode = z.infer<typeof contentModeSchema>;

export const visualModeSchema = z.enum(["pure-2d", "hybrid-2d"]);
export type VisualMode = z.infer<typeof visualModeSchema>;

export const aspectRatioSchema = z.enum(["9:16", "16:9"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const resolutionSchema = z.enum(["1080p", "540p"]);
export type Resolution = z.infer<typeof resolutionSchema>;

export const fpsSchema = z.union([z.literal(24), z.literal(30)]);
export type Fps = z.infer<typeof fpsSchema>;

export const styleIdSchema = z.enum([
  "midnight-cyan@1",
  "crimson-sakuga@1",
  "amber-explainer@1",
  "obsidian-gold@1",
]);
export type StyleId = z.infer<typeof styleIdSchema>;

export const templateIdSchema = z.enum([
  "hook-card@1",
  "manhwa-dialogue@1",
  "action-pan@1",
  "cause-effect@1",
  "comparison@1",
  "recap-payoff@1",
  "custom-canvas@1",
]);
export type TemplateId = z.infer<typeof templateIdSchema>;

export const transitionTypeSchema = z.enum(["cut", "wipe", "slide", "dissolve"]);
export type TransitionType = z.infer<typeof transitionTypeSchema>;

export const dualTextSchema = z.object({
  "hi-IN": z.string().max(4000).default(""),
  "en-US": z.string().max(4000).default(""),
});
export type DualText = z.infer<typeof dualTextSchema>;

export const cameraKeyframeSchema = z.object({
  at: z.number().min(0).max(1),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  zoom: z.number().min(0.5).max(2.5).default(1),
  shake: z.number().min(0).max(0.25).default(0),
});
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;

export const characterRigSchema = z.object({
  archetype: z
    .enum(["hero-noir", "mentor-sage", "rival-crimson", "analyst-cyan"])
    .default("hero-noir"),
  pose: z
    .enum(["idle", "determined", "pointing", "stride", "shocked"])
    .default("determined"),
  gaze: z.enum(["camera", "left", "right", "up"]).default("camera"),
  mouthState: z.enum(["auto", "closed", "open", "shout"]).default("auto"),
  hairFlow: z.number().min(0).max(1).default(0.65),
  palette: z
    .object({
      coat: z.string().optional(),
      accent: z.string().optional(),
      hair: z.string().optional(),
      skin: z.string().optional(),
    })
    .optional(),
});
export type CharacterRigProps = z.infer<typeof characterRigSchema>;

export const scenePropsSchema = z.object({
  headline: dualTextSchema.optional(),
  subhead: dualTextSchema.optional(),
  emphasis: z.array(z.string().max(80)).max(12).optional(),
  character: characterRigSchema.optional(),
  speedLines: z
    .object({
      enabled: z.boolean().default(false),
      intensity: z.number().min(0).max(1).default(0.45),
      originX: z.number().min(0).max(1).default(0.5),
      originY: z.number().min(0).max(1).default(0.45),
      color: z.string().optional(),
    })
    .optional(),
  panelReveal: z
    .object({
      layout: z.enum(["single", "split-diagonal", "triptych"]).default("single"),
      direction: z.enum(["left", "right", "up"]).default("left"),
      borderPx: z.number().min(1).max(8).default(3),
    })
    .optional(),
  chart: z
    .object({
      values: z.array(z.number()).min(1).max(8),
      labels: z.array(z.string().max(40)).min(1).max(8),
      unit: z.string().max(16).optional(),
      source: z.string().max(80).optional(),
    })
    .optional(),
  flow: z
    .object({
      nodes: z
        .array(z.object({ id: z.string().max(24), label: z.string().max(48) }))
        .min(2)
        .max(6),
      edges: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(10),
      activeStep: z.number().int().min(0).max(5).default(0),
    })
    .optional(),
  backdrop: z
    .object({
      mood: z.enum(["skyline", "temple", "void-grid", "storm"]).default("skyline"),
      prompt: z.string().max(400).optional(),
      scrim: z.number().min(0).max(0.95).default(0.55),
    })
    .optional(),
  customCode: z
    .object({
      kind: z.enum(["canvas2d", "svg", "p5"]).default("canvas2d"),
      code: z.string().max(40_000),
    })
    .optional(),
});
export type SceneProps = z.infer<typeof scenePropsSchema>;

export const sceneNodeSchema = z.object({
  id: z.string().min(1).max(40),
  template_id: templateIdSchema,
  narration: dualTextSchema,
  duration_hint_sec: z.number().min(1.5).max(30).default(4.5),
  pause_after_ms: z.number().int().min(0).max(2000).default(280),
  transition: transitionTypeSchema.default("dissolve"),
  props: scenePropsSchema.default({}),
  camera: z
    .array(cameraKeyframeSchema)
    .min(1)
    .max(8)
    .default([{ at: 0, x: 0.5, y: 0.5, zoom: 1, shake: 0 }]),
});
export type SceneNode = z.infer<typeof sceneNodeSchema>;

export const bgmConfigSchema = z
  .object({
    track_id: z.string().min(1).max(64),
    volume: z.number().min(0).max(0.5).default(0.14),
    drive_file_id: z.string().max(128).optional(),
  })
  .nullable()
  .default(null);
export type BgmConfig = z.infer<typeof bgmConfigSchema>;

export const publishTargetSchema = z.object({
  channel_slot: z.enum(["hindi", "english"]),
  title: z.string().max(100).default(""),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(40)).max(25).default([]),
  privacy_status: z.enum(["private", "unlisted", "public"]).default("private"),
  made_for_kids: z.boolean().default(false),
});
export type PublishTarget = z.infer<typeof publishTargetSchema>;

export const sceneGraphProjectSchema = z.object({
  title: dualTextSchema,
  mode: contentModeSchema.default("manhwa-anime"),
  visual_mode: visualModeSchema.default("pure-2d"),
  languages: z.array(languageCodeSchema).min(1).max(2).default(["hi-IN", "en-US"]),
  voices: z
    .object({
      "hi-IN": z.string().default(VOICE_BY_LANGUAGE["hi-IN"]),
      "en-US": z.string().default(VOICE_BY_LANGUAGE["en-US"]),
    })
    .default({
      "hi-IN": VOICE_BY_LANGUAGE["hi-IN"],
      "en-US": VOICE_BY_LANGUAGE["en-US"],
    }),
  aspect_ratio: aspectRatioSchema.default("9:16"),
  resolution: resolutionSchema.default("1080p"),
  fps: fpsSchema.default(30),
  seed: z.number().int().min(0).max(999_999).default(42),
  style_id: styleIdSchema.default("midnight-cyan@1"),
  scenes: z.array(sceneNodeSchema).min(1).max(MAX_SCENES),
  bgm: bgmConfigSchema,
  outputs: z
    .object({
      save_to_drive: z.boolean().default(true),
      drive_folder: z.string().min(1).max(120).default("AetherStudioExports"),
      captions: z.array(z.enum(["srt", "vtt"])).default(["srt", "vtt"]),
    })
    .default({
      save_to_drive: true,
      drive_folder: "AetherStudioExports",
      captions: ["srt", "vtt"],
    }),
  publish_targets: z
    .object({
      "hi-IN": publishTargetSchema,
      "en-US": publishTargetSchema,
    })
    .default({
      "hi-IN": {
        channel_slot: "hindi",
        title: "",
        description: "",
        tags: ["story", "hindi", "aetherstudio"],
        privacy_status: "private",
        made_for_kids: false,
      },
      "en-US": {
        channel_slot: "english",
        title: "",
        description: "",
        tags: ["story", "animation", "aetherstudio"],
        privacy_status: "private",
        made_for_kids: false,
      },
    }),
});

export const sceneGraphV1Schema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  project_id: z.string().min(3).max(64),
  project_revision: z.number().int().min(1),
  project: sceneGraphProjectSchema,
});
export type SceneGraphV1 = z.infer<typeof sceneGraphV1Schema>;

export function dimensionsForJob(
  aspectRatio: AspectRatio,
  resolution: Resolution,
): { width: number; height: number } {
  if (aspectRatio === "9:16") {
    return resolution === "1080p" ? { width: 1080, height: 1920 } : { width: 540, height: 960 };
  }
  return resolution === "1080p" ? { width: 1920, height: 1080 } : { width: 960, height: 540 };
}

/** RFC-8785 deterministic canonical JSON serialization (sorted object keys). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",") +
    "}"
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const STARTER_ANIME_RIG_CODE = `// Deterministic Custom 2D Code Contract: window.Aether.init & renderAt
window.Aether = {
  ctx: null,
  width: 1080,
  height: 1920,
  fps: 30,
  totalFrames: 150,
  async init(bundle) {
    this.width = bundle.width;
    this.height = bundle.height;
    this.fps = bundle.fps || 30;
    this.totalFrames = bundle.totalFrames || 150;
    const canvas = document.getElementById("aether-canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    this.ctx = canvas.getContext("2d");
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  },
  async renderAt(frameIndex) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const t = frameIndex / this.fps;
    const progress = Math.min(1, frameIndex / Math.max(1, this.totalFrames - 1));

    // Obsidian gradient sky
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, "#070B16");
    g.addColorStop(0.55, "#111A2E");
    g.addColorStop(1, "#17243B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Deterministic radial speed-lines
    ctx.save();
    ctx.translate(w * 0.5, h * 0.42);
    for (let i = 0; i < 42; i++) {
      const a = (i / 42) * Math.PI * 2 + t * 0.35;
      const r0 = 180 + ((i * 37) % 90);
      const r1 = Math.max(w, h) * 0.85;
      ctx.strokeStyle = i % 3 === 0 ? "rgba(93,230,255,0.22)" : "rgba(167,139,250,0.16)";
      ctx.lineWidth = i % 4 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();

    // Stylized 2D hero silhouette + cape flow
    const bob = Math.sin(t * 2.4) * 8;
    ctx.save();
    ctx.translate(w * 0.5, h * 0.56 + bob);
    ctx.fillStyle = "#0B1325";
    ctx.strokeStyle = "#5DE6FF";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-120, 260);
    ctx.quadraticCurveTo(-180 - Math.sin(t * 4) * 28, 60, -70, -70);
    ctx.lineTo(70, -70);
    ctx.quadraticCurveTo(180 + Math.cos(t * 4) * 24, 60, 130, 260);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Head + glowing visor eyes
    ctx.beginPath();
    ctx.arc(0, -135, 68, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#5DE6FF";
    ctx.fillRect(-36, -145, 24, 8);
    ctx.fillRect(12, -145, 24, 8);
    ctx.restore();

    // Kinetic title bar
    ctx.fillStyle = "rgba(7, 11, 22, 0.82)";
    ctx.fillRect(w * 0.08, h * 0.74, w * 0.84, 150);
    ctx.strokeStyle = "#FFD166";
    ctx.lineWidth = 3;
    ctx.strokeRect(w * 0.08, h * 0.74, w * 0.84, 150);

    ctx.fillStyle = "#F5F7FF";
    ctx.font = "700 44px 'Space Grotesk', 'Noto Sans Devanagari', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("AETHER CUSTOM 2D RIG", w * 0.5, h * 0.74 + 68);
    ctx.fillStyle = "#5DE6FF";
    ctx.font = "600 28px 'Inter', sans-serif";
    ctx.fillText("Frame " + frameIndex + " / " + this.totalFrames + " (" + Math.round(progress * 100) + "%)", w * 0.5, h * 0.74 + 116);
  }
};`;

export function createDefaultProject(): SceneGraphV1 {
  return {
    schema_version: SCHEMA_VERSION,
    project_id: "aether-demo-v2",
    project_revision: 1,
    project: {
      title: {
        "hi-IN": "एक विचार कहानी कैसे बनता है",
        "en-US": "How One Spark Becomes a 2D Story",
      },
      mode: "manhwa-anime",
      visual_mode: "pure-2d",
      languages: ["hi-IN", "en-US"],
      voices: {
        "hi-IN": VOICE_BY_LANGUAGE["hi-IN"],
        "en-US": VOICE_BY_LANGUAGE["en-US"],
      },
      aspect_ratio: "9:16",
      resolution: "1080p",
      fps: 30,
      seed: 42,
      style_id: "midnight-cyan@1",
      scenes: [
        {
          id: "s1",
          template_id: "hook-card@1",
          narration: {
            "hi-IN": "हर बड़ी कहानी एक ऐसे सवाल से शुरू होती है जो आपको वहीं रोक दे।",
            "en-US": "Every unforgettable story starts with one sharp question that stops you cold.",
          },
          duration_hint_sec: 4.5,
          pause_after_ms: 280,
          transition: "dissolve",
          props: {
            headline: {
              "hi-IN": "एक तीखा सवाल",
              "en-US": "ONE SHARP QUESTION",
            },
            subhead: {
              "hi-IN": "शून्य से पूरी 2D कहानी",
              "en-US": "From Raw Spark to 2D Cinema",
            },
            emphasis: ["सवाल", "SHARP QUESTION"],
            speedLines: { enabled: true, intensity: 0.55, originX: 0.5, originY: 0.42 },
            backdrop: { mood: "skyline", scrim: 0.55 },
          },
          camera: [
            { at: 0, x: 0.5, y: 0.5, zoom: 1.0, shake: 0 },
            { at: 1, x: 0.5, y: 0.47, zoom: 1.09, shake: 0.015 },
          ],
        },
        {
          id: "s2",
          template_id: "manhwa-dialogue@1",
          narration: {
            "hi-IN": "जब आप कोड में दृश्य रचते हैं, तो हर फ्रेम बिल्कुल सटीक और साफ रहता है।",
            "en-US": "When scenes live in clean 2D code, every frame stays crisp on mobile and 4K.",
          },
          duration_hint_sec: 5.0,
          pause_after_ms: 280,
          transition: "wipe",
          props: {
            headline: {
              "hi-IN": "सटीक 2D एनीमेशन",
              "en-US": "DETERMINISTIC 2D RIG",
            },
            character: {
              archetype: "hero-noir",
              pose: "determined",
              gaze: "camera",
              mouthState: "auto",
              hairFlow: 0.75,
            },
            panelReveal: { layout: "split-diagonal", direction: "left", borderPx: 3 },
            speedLines: { enabled: true, intensity: 0.35, originX: 0.5, originY: 0.4 },
            backdrop: { mood: "temple", scrim: 0.5 },
          },
          camera: [
            { at: 0, x: 0.48, y: 0.52, zoom: 1.0, shake: 0 },
            { at: 1, x: 0.52, y: 0.48, zoom: 1.06, shake: 0.01 },
          ],
        },
        {
          id: "s3",
          template_id: "cause-effect@1",
          narration: {
            "hi-IN": "एक ही दृश्य ग्राफ से हिंदी और अंग्रेज़ी दोनों आवाज़ें बिना किसी ड्रिफ्ट के जुड़ती हैं।",
            "en-US": "One scene graph powers both Hindi and English voiceovers with zero audio drift.",
          },
          duration_hint_sec: 5.2,
          pause_after_ms: 300,
          transition: "slide",
          props: {
            headline: {
              "hi-IN": "दो भाषाएँ, एक विज़ुअल",
              "en-US": "SAME VISUALS · DUAL VOICES",
            },
            flow: {
              nodes: [
                { id: "n1", label: "SceneGraphV1" },
                { id: "n2", label: "48kHz Edge-TTS" },
                { id: "n3", label: "HI + EN MP4" },
              ],
              edges: [
                [0, 1],
                [1, 2],
              ],
              activeStep: 1,
            },
            backdrop: { mood: "void-grid", scrim: 0.6 },
          },
          camera: [
            { at: 0, x: 0.5, y: 0.5, zoom: 1.0, shake: 0 },
            { at: 1, x: 0.5, y: 0.5, zoom: 1.04, shake: 0 },
          ],
        },
        {
          id: "s4",
          template_id: "recap-payoff@1",
          narration: {
            "hi-IN": "अब अपने वीडियो को सीधे गूगल ड्राइव और यूट्यूब के दोनों चैनलों पर भेजें।",
            "en-US": "Render directly in Colab, save to Drive, and publish to both channels cleanly.",
          },
          duration_hint_sec: 4.8,
          pause_after_ms: 350,
          transition: "dissolve",
          props: {
            headline: {
              "hi-IN": "तैयार है आपका स्टूडियो",
              "en-US": "READY FOR LAUNCH",
            },
            subhead: {
              "hi-IN": "Drive + YouTube ड्यूल एक्सपोर्ट",
              "en-US": "Dual-Channel Drive & YouTube Export",
            },
            character: {
              archetype: "analyst-cyan",
              pose: "pointing",
              gaze: "camera",
              mouthState: "auto",
              hairFlow: 0.5,
            },
            speedLines: { enabled: true, intensity: 0.4, originX: 0.5, originY: 0.48 },
            backdrop: { mood: "storm", scrim: 0.5 },
          },
          camera: [
            { at: 0, x: 0.5, y: 0.52, zoom: 1.05, shake: 0 },
            { at: 1, x: 0.5, y: 0.5, zoom: 1.0, shake: 0 },
          ],
        },
      ],
      bgm: null,
      outputs: {
        save_to_drive: true,
        drive_folder: "AetherStudioExports",
        captions: ["srt", "vtt"],
      },
      publish_targets: {
        "hi-IN": {
          channel_slot: "hindi",
          title: "एक विचार 2D कहानी कैसे बनता है",
          description: "Aether Studio v2.0 द्वारा निर्मित 2D एनिमेटेड कहानी।",
          tags: ["AetherStudio", "HindiStory", "2DAnimation"],
          privacy_status: "private",
          made_for_kids: false,
        },
        "en-US": {
          channel_slot: "english",
          title: "How One Spark Becomes a 2D Story",
          description: "Created with Aether Studio v2.0 deterministic 2D code-to-video pipeline.",
          tags: ["AetherStudio", "2DAnimation", "Storytelling"],
          privacy_status: "private",
          made_for_kids: false,
        },
      },
    },
  };
}
