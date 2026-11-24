import crypto from "node:crypto";
import {
  DEFAULT_ZERO_SPEND_POLICY,
  type KrSettingsSnapshot,
  type KrStoryBible,
  type KrStoryPatch,
  type KrStoryPatchOperation,
  type KrStoryRevision,
} from "../contracts/schemas.ts";

export function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function defaultSettingsSnapshot(): KrSettingsSnapshot {
  return {
    director_route: "deterministic-local-director",
    image_baseline: {
      model_id: "black-forest-labs/FLUX.2-klein-4B",
      model_revision: "e7b7dc27f91deacad38e78976d1f2b499d76a294",
      width: 1344,
      height: 768,
      steps: 4,
      guidance_scale: 1.0,
      grade_profile: "restrained-v1",
      text_encoder: "Qwen3ForCausalLM-NF4-FP32",
    },
    voices: {
      hi: {
        language: "hi",
        provider: "edge_tts_free",
        voice_id: "hi-IN-SwaraNeural",
        speaking_rate: 1.0,
      },
      en: {
        language: "en",
        provider: "edge_tts_free",
        voice_id: "en-IN-NeerjaNeural",
        speaking_rate: 1.0,
      },
    },
    caption_style: "single_active_lang",
    zero_spend: DEFAULT_ZERO_SPEND_POLICY,
    drive_export_folder_id: "15ek6wQirJz7d0DCLf6fvFWtMRvWpcLHx",
  };
}

export function buildDefaultStoryBible(projectId: string, customPrompt?: string): KrStoryBible {
  const promptHint = customPrompt?.trim();
  const title = promptHint ? promptHint.slice(0, 56) : "Stepwell Echoes — बावड़ी की गूँज";
  return {
    project_id: projectId,
    title,
    logline:
      promptHint ||
      "When monsoon dusk falls over an abandoned sandstone stepwell, archivist Meera decodes glowing Devanagari inscriptions that awaken forgotten water songs.",
    style_bible:
      "Restrained twilight anime cinema, clean architectural linework, sandstone amber lantern key light against deep indigo twilight, 16:9 composition.",
    aspect_ratio: "16:9",
    resolution: { width: 1344, height: 768 },
    characters: [
      {
        id: "char_meera",
        name: "Meera",
        role: "Lead Archivist",
        visual_bible:
          "Young Indian woman in dark indigo cotton shawl, brass field lantern in left hand, round silver-framed spectacles, braided hair.",
        hi_voice_profile: "hi-IN-SwaraNeural",
        en_voice_profile: "en-IN-NeerjaNeural",
        continuity_notes: "Brass lantern warmth anchors every scene; never change shawl color.",
      },
      {
        id: "char_kabir",
        name: "Kabir",
        role: "Acoustic Historian",
        visual_bible:
          "Slate-blue linen kurta, weathered leather field notebook, copper tuning fork.",
        hi_voice_profile: "hi-IN-MadhurNeural",
        en_voice_profile: "en-IN-PrabhatNeural",
        continuity_notes: "Speaks measured lines near resonant stone walls.",
      },
    ],
    world_rules: [
      "Stepwell water only illuminates glyphs at dusk when touched by sound.",
      "Keep character wardrobe and brass lantern continuity locked across all scenes.",
      "Zero stock B-roll substitution; every frame uses illustrated anime plates.",
    ],
    scenes: [
      {
        scene_id: "sc_01",
        order_index: 0,
        chapter_title: "Act I · Dusk Descent",
        title: "Lantern at the Upper Steps",
        location: "Upper rim of Chand Baori stepwell",
        mood: "hushed anticipation",
        camera_direction: "wide establishing slow push-in",
        visual_prompt:
          "Restrained twilight anime film frame of Meera standing at the top of a vast geometric sandstone stepwell holding a warm brass lantern, deep indigo dusk sky, fine monsoon mist, 1344x768.",
        negative_prompt: "text, watermark, signature, distorted hands, extra fingers, lowres",
        seed: 420101,
        hi_narration: "मीरा पीतल की लालटेन थामे पुरानी बावड़ी की सीढ़ियों पर रुकती है—नीचे ठहरे पानी में समय जैसे साँस रोके बैठा है।",
        en_narration: "Holding her brass lantern steady, Meera pauses at the rim of the ancient stepwell—where still water below seems to hold its breath.",
        sfx_cues: ["whoosh"],
        ambience_profile: "wind",
        target_duration_sec: 8,
        locked_canon: true,
      },
      {
        scene_id: "sc_02",
        order_index: 1,
        chapter_title: "Act II · Resonance",
        title: "The Copper Tuning Fork",
        location: "Mid-tier carved pavilion",
        mood: "curious and tense",
        camera_direction: "medium two-shot pan left",
        visual_prompt:
          "Anime cinematic medium shot of Meera and Kabir inside a carved sandstone alcove, Kabir holding a copper tuning fork as faint golden ripples wake carved Devanagari lines on damp stone.",
        negative_prompt: "text, watermark, signature, distorted faces, modern electronics",
        seed: 420102,
        hi_narration: "कबीर के तांबे के स्वर-काँटे की हल्की गूँज से भीगी दीवार पर देवनागरी की उकेरी रेखाएँ सुनहरी चमक उठाती हैं।",
        en_narration: "A single hum from Kabir's copper tuning fork wakes faint golden Devanagari lines along the damp sandstone wall.",
        sfx_cues: ["ding", "rumble"],
        ambience_profile: "temple_hall",
        target_duration_sec: 9,
        locked_canon: false,
      },
      {
        scene_id: "sc_03",
        order_index: 2,
        chapter_title: "Act III · Awakening",
        title: "Water Remembers",
        location: "Lowest stepwell water chamber",
        mood: "quiet wonder",
        camera_direction: "low-angle slow pull-back",
        visual_prompt:
          "Low-angle restrained anime cinema shot from near the stepwell water surface, warm lantern light and bioluminescent cyan-gold glyph reflections illuminating Meera's face in wonder.",
        negative_prompt: "text, watermark, signature, oversaturated neon, blurry",
        seed: 420103,
        hi_narration: "तलहटी के पानी में अक्षर तैरकर एक पूरा राग रच देते हैं—यह पत्थर नहीं, भूली हुई स्मृतियों का संदूक था।",
        en_narration: "At the bottom chamber, reflected letters gather into an entire melody—this was never mere stone, but a vault of remembered music.",
        sfx_cues: ["thump"],
        ambience_profile: "rain",
        target_duration_sec: 8,
        locked_canon: false,
      },
    ],
  };
}

export class StoryPatchRequestError extends Error {
  readonly status = 422;
  readonly code = "STORY_EDIT_CLARIFICATION_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "StoryPatchRequestError";
  }
}

function hasEndingPreservationConstraint(instruction: string): boolean {
  return (
    /\b(ending|end|finale|climax)\b[^.!?\n]{0,48}\b(unchanged|preserve|keep|same|intact|mat\s+badl\w*|na\s+badl\w*|nahi\s+badl\w*|same\s+rakh\w*|untouched)\b/i.test(
      instruction,
    ) ||
    /\b(preserve|keep|don'?t\s+(?:change|touch|alter|edit|modify)|do\s+not\s+(?:change|touch|alter|edit|modify)|leave)\b[^.!?\n]{0,48}\b(ending|end|finale)\b/i.test(
      instruction,
    ) ||
    /\b(no\s+new\s+scene|don'?t\s+add\s+(?:a\s+)?scene|do\s+not\s+add\s+(?:a\s+)?scene|scene\s+mat\s+add|naya\s+scene\s+nahi)\b/i.test(
      instruction,
    )
  );
}

function wantsNewSceneInsertion(instruction: string): boolean {
  if (hasEndingPreservationConstraint(instruction)) return false;
  return (
    /\b(add\s+(?:a\s+)?(?:new\s+)?(?:dawn\s+)?(?:ending\s+)?scene|insert\s+(?:a\s+)?scene|append\s+(?:a\s+)?scene|create\s+(?:a\s+)?(?:new\s+)?scene|naya\s+scene\s+add|ek\s+aur\s+scene\s+(?:add|jod|lag))\b/i.test(
      instruction,
    ) || /^\s*add\s+dawn\s+ending\s+scene\s*$/i.test(instruction)
  );
}

function parseExplicitTargetSceneNumber(instruction: string): number | null {
  const matches = [...instruction.matchAll(/\b(?:scene|sc|दृश्य)\s*#?_?0?(\d+)\b/gi)];
  if (matches.length === 0) return null;

  const positiveTargets: number[] = [];
  for (const m of matches) {
    const num = Number.parseInt(m[1], 10);
    const idx = m.index ?? 0;
    const windowAfter = instruction.slice(idx, Math.min(instruction.length, idx + 48));
    const windowBefore = instruction.slice(Math.max(0, idx - 32), idx);
    const isPreserved =
      /\b(unchanged|preserve|keep|untouched|mat\s+badl\w*|na\s+badl\w*|skip)\b/i.test(windowAfter) ||
      /\b(except|not|leave|preserve)\b/i.test(windowBefore);
    if (!isPreserved && Number.isFinite(num)) {
      positiveTargets.push(num);
    }
  }

  const unique = [...new Set(positiveTargets)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    throw new StoryPatchRequestError(
      `Multiple target scenes (${unique.join(", ")}) specified in one request. Edit one scene per proposal so canon diffs stay verifiable.`,
    );
  }
  return null;
}

function hasPositiveCharacterEditRequest(instruction: string): boolean {
  const mentionsCharChange =
    /\b(change|rename|replace|remove|modify|redesign|alter)\b[^.!?\n]{0,36}\b(character|characters|meera|kabir|wardrobe|shawl|lantern)\b/i.test(
      instruction,
    );
  if (!mentionsCharChange) return false;
  const preservesChars =
    /\b(character|characters|meera|kabir)\b[^.!?\n]{0,40}\b(unchanged|preserve|keep|same|intact|mat\s+badl\w*)\b/i.test(
      instruction,
    );
  return !preservesChars;
}

function hasLightRainAtmosphere(scene: KrStoryBible["scenes"][number]): boolean {
  return (
    /\b(light monsoon rain|light monsoon drizzle|light rain|drizzle|gentle rain|halki baarish)\b/i.test(
      scene.visual_prompt,
    ) || /\b(light monsoon drizzle|light rain|drizzle)\b/i.test(scene.mood)
  );
}

function hasRainAtmosphere(scene: KrStoryBible["scenes"][number]): boolean {
  return (
    hasLightRainAtmosphere(scene) ||
    /\b(steady monsoon rain|monsoon rain|glistening sandstone|\brain\b)\b/i.test(scene.visual_prompt) ||
    /\b(rain|drizzle|monsoon)\b/i.test(scene.mood)
  );
}

function hasTenseAtmosphere(scene: KrStoryBible["scenes"][number]): boolean {
  return /\b(deepened twilight shadows|tighter dramatic atmospheric contrast)\b/i.test(
    scene.visual_prompt,
  );
}

function hasTightenedHindiCadence(scene: KrStoryBible["scenes"][number]): boolean {
  return /गूँज और गहरी हो जाती है/i.test(scene.hi_narration);
}

function isCameraAlreadyApplied(
  scene: KrStoryBible["scenes"][number],
  targetCamera: string,
): boolean {
  const cur = scene.camera_direction.trim().toLowerCase();
  const next = targetCamera.trim().toLowerCase();
  if (cur === next) return true;
  if (
    next.includes("with measured dramatic framing") &&
    cur.includes("with measured dramatic framing")
  ) {
    return true;
  }
  return false;
}

function hasDawnEndingScene(bible: KrStoryBible): boolean {
  return bible.scenes.some(
    (s) => s.title.trim().toLowerCase() === "dawn over the stepwell",
  );
}

function formatEditableSceneGuidance(revision: KrStoryRevision): string {
  const editableNumbers = revision.bible.scenes
    .map((s, idx) => (!s.locked_canon ? idx + 1 : null))
    .filter((n): n is number => n !== null);
  if (editableNumbers.length === 0) {
    return "All scenes in this revision are currently canon-locked. Unlock a scene first.";
  }
  const labels = editableNumbers.map((n) => `Scene ${n}`).join(", ");
  return `Unlock it first or target a currently editable scene (${labels}).`;
}

export function isOperationAlreadyApplied(
  bible: KrStoryBible,
  op: KrStoryPatchOperation,
): boolean {
  if (op.op === "insert_scene") {
    const candidate = op.after as KrStoryBible["scenes"][number] | undefined;
    if (!candidate) return false;
    return bible.scenes.some(
      (s) =>
        s.scene_id === candidate.scene_id ||
        s.title.trim().toLowerCase() === candidate.title.trim().toLowerCase(),
    );
  }

  if (op.op === "update_scene") {
    const scene = bible.scenes.find((s) => s.scene_id === op.target_id);
    if (!scene) return false;
    const field = op.field_path.split(".").pop();
    if (!field || typeof op.after !== "string") return false;

    const currentVal = (scene as Record<string, unknown>)[field];
    if (typeof currentVal !== "string") return false;
    if (currentVal.trim() === op.after.trim()) return true;

    if (typeof op.before === "string" && op.after.startsWith(op.before)) {
      const addedSuffix = op.after.slice(op.before.length).trim();
      if (addedSuffix && currentVal.includes(addedSuffix)) {
        return true;
      }
    }

    if (field === "visual_prompt") {
      if (/\blight monsoon rain\b/i.test(op.after) && hasLightRainAtmosphere(scene)) return true;
      if (/\bsteady monsoon rain\b/i.test(op.after) && hasRainAtmosphere(scene)) return true;
      if (/\bdeepened twilight shadows\b/i.test(op.after) && hasTenseAtmosphere(scene)) return true;
    }
    if (field === "mood" && /\blight monsoon drizzle\b/i.test(op.after)) {
      return /\b(light monsoon drizzle|light rain|drizzle)\b/i.test(scene.mood);
    }
    if (field === "hi_narration" && /गूँज और गहरी हो जाती है/.test(op.after)) {
      return hasTightenedHindiCadence(scene);
    }
    if (field === "camera_direction") {
      return isCameraAlreadyApplied(scene, op.after);
    }
  }

  if (op.op === "update_bible" && op.field_path === "style_bible" && typeof op.after === "string") {
    if (bible.style_bible.trim() === op.after.trim()) return true;
    if (typeof op.before === "string" && op.after.startsWith(op.before)) {
      const added = op.after.slice(op.before.length).trim();
      if (added && bible.style_bible.includes(added)) return true;
    }
  }

  return false;
}

/**
 * Propose a canon-preserving, semantically idempotent structured StoryPatch from a chat instruction.
 * Respects `locked_canon: true` scenes unless explicitly instructed to override,
 * honors negative/preservation constraints, treats already-applied changes as no-op,
 * and fails closed with clarification on unsupported or ambiguous instructions.
 */
export function proposeStoryPatch(params: {
  revision: KrStoryRevision;
  instruction: string;
  allowLockedOverride?: boolean;
}): { patch: KrStoryPatch | null; noOp: boolean; assistantMessage: string } {
  const { revision, instruction } = params;
  const trimmed = instruction.trim();
  const allowLocked = params.allowLockedOverride ?? false;
  const lower = trimmed.toLowerCase();
  const operations: KrStoryPatchOperation[] = [];
  const alreadyAppliedReasons: string[] = [];

  if (!trimmed) {
    throw new StoryPatchRequestError("Please enter a specific story edit instruction.");
  }

  if (hasPositiveCharacterEditRequest(trimmed)) {
    throw new StoryPatchRequestError(
      "Character canon (Meera, Kabir, wardrobe, brass lantern) is protected across revisions. Target an editable scene's atmosphere, lighting, camera direction, or narration pacing instead.",
    );
  }

  if (wantsNewSceneInsertion(trimmed)) {
    if (hasDawnEndingScene(revision.bible)) {
      alreadyAppliedReasons.push("Dawn Over the Stepwell ending scene is already present");
    } else {
      const nextIdx = revision.bible.scenes.length;
      const newSceneId = `sc_${String(nextIdx + 1).padStart(2, "0")}`;
      const newScene = {
        scene_id: newSceneId,
        order_index: nextIdx,
        chapter_title: `Act ${nextIdx + 1} · Echo`,
        title: "Dawn Over the Stepwell",
        location: "Upper courtyard at first light",
        mood: "hopeful resolution",
        camera_direction: "slow crane up",
        visual_prompt:
          "Restrained anime dawn frame over sandstone stepwell, pale gold morning haze, Meera closing her field notebook beside her brass lantern, 1344x768.",
        negative_prompt: "text, watermark, signature, lowres",
        seed: 420100 + nextIdx + 1,
        hi_narration: "भोर की पहली किरण में मीरा अपनी डायरी बंद करती है—बावड़ी अब फिर से बोलना जानती है।",
        en_narration: "As first dawn touches the rim, Meera closes her notebook—the stepwell remembers how to sing again.",
        sfx_cues: ["ding"] as Array<"whoosh" | "thump" | "rumble" | "crash" | "creak" | "ding" | "pop">,
        ambience_profile: "warm_room" as const,
        target_duration_sec: 8,
        locked_canon: false,
      };
      operations.push({
        op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
        op: "insert_scene",
        target_id: newSceneId,
        field_path: `scenes[${nextIdx}]`,
        before: null,
        after: newScene,
        rationale: "Append new scene while preserving all existing locked canon and character profiles.",
      });
    }
  } else {
    const explicitSceneNum = parseExplicitTargetSceneNumber(trimmed);
    let targetScene: KrStoryBible["scenes"][number] | undefined;

    if (explicitSceneNum !== null) {
      if (explicitSceneNum < 1 || explicitSceneNum > revision.bible.scenes.length) {
        throw new StoryPatchRequestError(
          `Scene ${explicitSceneNum} does not exist in Story v${revision.version} (valid scenes: 1–${revision.bible.scenes.length}).`,
        );
      }
      const candidate = revision.bible.scenes[explicitSceneNum - 1];
      if (candidate.locked_canon && !allowLocked) {
        throw new StoryPatchRequestError(
          `Scene ${explicitSceneNum} (${candidate.title}) is canon-locked. ${formatEditableSceneGuidance(revision)}`,
        );
      }
      targetScene = candidate;
    } else {
      targetScene =
        revision.bible.scenes.find((s) => !s.locked_canon) ??
        (allowLocked ? revision.bible.scenes[0] : undefined);
    }

    if (!targetScene) {
      throw new StoryPatchRequestError(
        "All scenes in this revision are canon-locked. Unlock an editable scene first before proposing a scene diff.",
      );
    }

    const isLightRain =
      /\b(light\s+(?:monsoon\s+)?rain|halki\s+b[a]+rish|halki\s+barsaat|drizzle|gentle\s+(?:monsoon\s+)?rain)\b/i.test(
        lower,
      ) || /हल्की\s*बारिश/.test(trimmed);
    const isRain =
      isLightRain ||
      /\b(rain|monsoon|storm|b[a]+rish|barsaat)\b/i.test(lower) ||
      /बारिश|बरसात/.test(trimmed);
    const isTenseOrMood =
      /\b(tense|tension|cliffhanger|suspense|mystery|mysterious|shadow|shadows|dark|darker|dramatic|atmosphere|mood|lighting|mahaul|mist|fog|lantern|glow)\b/i.test(
        lower,
      );
    const wantsHindiPacing =
      /\b(hindi|pacing|tight|tighten|shorter|concise)\b/i.test(lower) &&
      !/\b(narration|hindi)\b[^.!?\n]{0,30}\b(unchanged|preserve|same)\b/i.test(lower);
    const wantsCamera =
      /\b(camera|wide\s+shot|close[- ]?up|closeup|push[- ]?in|pull[- ]?back|angle|framing)\b/i.test(
        lower,
      );

    if (isRain || isTenseOrMood) {
      if (isLightRain) {
        let addedAny = false;
        if (!hasLightRainAtmosphere(targetScene)) {
          operations.push({
            op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
            op: "update_scene",
            target_id: targetScene.scene_id,
            field_path: `scenes.${targetScene.scene_id}.visual_prompt`,
            before: targetScene.visual_prompt,
            after: `${targetScene.visual_prompt} Emphasize light monsoon rain atmosphere with delicate mist and softly glistening sandstone surfaces.`,
            rationale: `Refine editable scene ${targetScene.scene_id} atmosphere per user request while preserving characters, locked canon, and ending.`,
          });
          addedAny = true;
        }
        if (!/\b(light monsoon drizzle|light rain|drizzle)\b/i.test(targetScene.mood)) {
          operations.push({
            op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
            op: "update_scene",
            target_id: targetScene.scene_id,
            field_path: `scenes.${targetScene.scene_id}.mood`,
            before: targetScene.mood,
            after: `${targetScene.mood}, light monsoon drizzle`,
            rationale: `Record light rain atmosphere on scene ${targetScene.scene_id}.`,
          });
          addedAny = true;
        }
        if (!addedAny) {
          alreadyAppliedReasons.push(
            `light monsoon rain atmosphere is already applied on ${targetScene.scene_id}`,
          );
        }
      } else if (isRain) {
        if (!hasRainAtmosphere(targetScene)) {
          operations.push({
            op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
            op: "update_scene",
            target_id: targetScene.scene_id,
            field_path: `scenes.${targetScene.scene_id}.visual_prompt`,
            before: targetScene.visual_prompt,
            after: `${targetScene.visual_prompt} Emphasize steady monsoon rain with glistening sandstone highlights.`,
            rationale: `Refine editable scene ${targetScene.scene_id} atmosphere per user request while preserving characters, locked canon, and ending.`,
          });
        } else {
          alreadyAppliedReasons.push(
            `monsoon rain atmosphere is already applied on ${targetScene.scene_id}`,
          );
        }
      } else if (isTenseOrMood) {
        if (!hasTenseAtmosphere(targetScene)) {
          operations.push({
            op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
            op: "update_scene",
            target_id: targetScene.scene_id,
            field_path: `scenes.${targetScene.scene_id}.visual_prompt`,
            before: targetScene.visual_prompt,
            after: `${targetScene.visual_prompt} Emphasize deepened twilight shadows and tighter dramatic atmospheric contrast.`,
            rationale: `Refine editable scene ${targetScene.scene_id} atmosphere per user request while preserving characters, locked canon, and ending.`,
          });
        } else {
          alreadyAppliedReasons.push(
            `dramatic shadow atmosphere is already applied on ${targetScene.scene_id}`,
          );
        }
      }
    }

    if (wantsHindiPacing) {
      if (!hasTightenedHindiCadence(targetScene)) {
        operations.push({
          op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
          op: "update_scene",
          target_id: targetScene.scene_id,
          field_path: `scenes.${targetScene.scene_id}.hi_narration`,
          before: targetScene.hi_narration,
          after: `${targetScene.hi_narration} गूँज और गहरी हो जाती है।`,
          rationale: `Tighten Hindi cadence on editable scene ${targetScene.scene_id}.`,
        });
      } else {
        alreadyAppliedReasons.push(
          `Hindi pacing cadence is already applied on ${targetScene.scene_id}`,
        );
      }
    }

    if (wantsCamera) {
      const nextCam = /\bclose[- ]?up|closeup\b/i.test(lower)
        ? "intimate medium close-up slow push-in"
        : /\bwide\b/i.test(lower)
          ? "wide architectural framing"
          : `${targetScene.camera_direction} with measured dramatic framing`;
      if (!isCameraAlreadyApplied(targetScene, nextCam)) {
        operations.push({
          op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
          op: "update_scene",
          target_id: targetScene.scene_id,
          field_path: `scenes.${targetScene.scene_id}.camera_direction`,
          before: targetScene.camera_direction,
          after: nextCam,
          rationale: `Adjust camera direction on editable scene ${targetScene.scene_id}.`,
        });
      } else {
        alreadyAppliedReasons.push(
          `requested camera direction is already active on ${targetScene.scene_id}`,
        );
      }
    }
  }

  if (operations.length === 0) {
    if (alreadyAppliedReasons.length > 0) {
      return {
        patch: null,
        noOp: true,
        assistantMessage: `No-op on Story v${revision.version}: ${alreadyAppliedReasons.join("; ")}. Existing text left unchanged without duplication.`,
      };
    }

    const editableNumbers = revision.bible.scenes
      .map((s, idx) => (!s.locked_canon ? idx + 1 : null))
      .filter((n): n is number => n !== null);
    const editableHint =
      editableNumbers.length > 0
        ? `currently editable: ${editableNumbers.map((n) => `Scene ${n}`).join(", ")}`
        : "all scenes are currently locked";

    throw new StoryPatchRequestError(
      `Could not map "${trimmed.slice(0, 70)}" to a concrete edit on Story v${revision.version}. Specify an editable scene (${editableHint}) and a clear atmosphere/rain, lighting, camera, Hindi pacing, or new-scene change.`,
    );
  }

  const patch: KrStoryPatch = {
    patch_id: `patch_${crypto.randomBytes(6).toString("hex")}`,
    project_id: revision.project_id,
    base_story_revision_id: revision.revision_id,
    status: "pending",
    summary: `Canon-safe patch for "${trimmed.slice(0, 80)}"`,
    operations,
    created_at: new Date().toISOString(),
  };

  return {
    patch,
    noOp: false,
    assistantMessage: `Prepared ${operations.length} structured diff operation(s) anchored to Story v${revision.version}. Locked canon scenes remain untouched. Review and Accept, Reject, or Rebase below.`,
  };
}

export function applyStoryPatchToBible(
  bible: KrStoryBible,
  patch: KrStoryPatch,
): KrStoryBible {
  const next: KrStoryBible = structuredClone(bible);

  for (const op of patch.operations) {
    if (isOperationAlreadyApplied(next, op)) {
      continue;
    }

    if (op.op === "insert_scene") {
      const candidate = op.after as KrStoryBible["scenes"][number];
      if (!next.scenes.some((s) => s.scene_id === candidate.scene_id)) {
        next.scenes.push(candidate);
      }
    } else if (op.op === "update_scene") {
      const scene = next.scenes.find((s) => s.scene_id === op.target_id);
      if (!scene) continue;
      if (scene.locked_canon) {
        throw new Error(`Canon guard: scene ${scene.scene_id} is locked`);
      }
      const field = op.field_path.split(".").pop();
      if (field === "visual_prompt" && typeof op.after === "string") scene.visual_prompt = op.after;
      if (field === "hi_narration" && typeof op.after === "string") scene.hi_narration = op.after;
      if (field === "en_narration" && typeof op.after === "string") scene.en_narration = op.after;
      if (field === "mood" && typeof op.after === "string") scene.mood = op.after;
      if (field === "camera_direction" && typeof op.after === "string") scene.camera_direction = op.after;
    } else if (op.op === "update_bible" && op.field_path === "style_bible" && typeof op.after === "string") {
      next.style_bible = op.after;
    }
  }
  return next;
}

export function rebaseStoryPatch(
  latestRevision: KrStoryRevision,
  stalePatch: KrStoryPatch,
):
  | { ok: true; alreadyApplied: boolean; rebasedPatch: KrStoryPatch }
  | { ok: false; conflictReason: string } {
  const remainingOps: KrStoryPatchOperation[] = [];

  for (const op of stalePatch.operations) {
    if (isOperationAlreadyApplied(latestRevision.bible, op)) {
      continue;
    }

    if (op.op === "update_scene") {
      const scene = latestRevision.bible.scenes.find((s) => s.scene_id === op.target_id);
      if (!scene) {
        return {
          ok: false,
          conflictReason: `Target scene ${op.target_id} no longer exists in v${latestRevision.version}.`,
        };
      }
      if (scene.locked_canon) {
        return {
          ok: false,
          conflictReason: `Target scene ${op.target_id} is now canon-locked in v${latestRevision.version}.`,
        };
      }
      const field = op.field_path.split(".").pop() as keyof typeof scene | undefined;
      if (field && scene[field] !== op.before) {
        // Rebase additive string refinements cleanly onto updated text instead of failing or duplicating
        const currentFieldVal = scene[field];
        if (
          typeof currentFieldVal === "string" &&
          typeof op.before === "string" &&
          typeof op.after === "string" &&
          op.after.startsWith(op.before)
        ) {
          const addedSuffix = op.after.slice(op.before.length);
          remainingOps.push({
            ...op,
            before: currentFieldVal,
            after: `${currentFieldVal}${addedSuffix}`,
          });
          continue;
        }
        return {
          ok: false,
          conflictReason: `Field ${op.field_path} was already modified in v${latestRevision.version}.`,
        };
      }
    }

    remainingOps.push(op);
  }

  const alreadyApplied = remainingOps.length === 0;
  return {
    ok: true,
    alreadyApplied,
    rebasedPatch: {
      ...stalePatch,
      base_story_revision_id: latestRevision.revision_id,
      status: "rebased",
      operations: remainingOps,
      summary: alreadyApplied
        ? `${stalePatch.summary} (already applied in v${latestRevision.version}; no-op)`
        : `${stalePatch.summary} (rebased to v${latestRevision.version})`,
    },
  };
}
