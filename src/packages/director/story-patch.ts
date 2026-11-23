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

/**
 * Propose a canon-preserving structured StoryPatch from a chat instruction.
 * Respects `locked_canon: true` scenes unless explicitly instructed to override.
 */
export function proposeStoryPatch(params: {
  revision: KrStoryRevision;
  instruction: string;
  allowLockedOverride?: boolean;
}): { patch: KrStoryPatch; assistantMessage: string } {
  const { revision, instruction } = params;
  const allowLocked = params.allowLockedOverride ?? false;
  const lower = instruction.toLowerCase();
  const operations: KrStoryPatchOperation[] = [];

  const targetScene =
    revision.bible.scenes.find((s) => !s.locked_canon) ??
    (allowLocked ? revision.bible.scenes[0] : undefined);

  if (lower.includes("add scene") || lower.includes("new scene") || lower.includes("ending")) {
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
  } else if (targetScene) {
    const moodSuffix = lower.includes("rain") || lower.includes("storm")
      ? "drenched in steady monsoon rain with glistening sandstone highlights"
      : lower.includes("tense") || lower.includes("mystery")
        ? "deepened shadows and tighter dramatic framing"
        : "sharper emotional pacing and cleaner visual contrast";

    operations.push({
      op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
      op: "update_scene",
      target_id: targetScene.scene_id,
      field_path: `scenes.${targetScene.scene_id}.visual_prompt`,
      before: targetScene.visual_prompt,
      after: `${targetScene.visual_prompt} Emphasize ${moodSuffix}.`,
      rationale: `Refine unlocked scene ${targetScene.scene_id} visual direction per user note without breaking Meera/Kabir canon.`,
    });

    if (lower.includes("hindi") || lower.includes("tight") || lower.includes("shorter")) {
      operations.push({
        op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
        op: "update_scene",
        target_id: targetScene.scene_id,
        field_path: `scenes.${targetScene.scene_id}.hi_narration`,
        before: targetScene.hi_narration,
        after: `${targetScene.hi_narration} गूँज और गहरी हो जाती है।`,
        rationale: "Tighten Hindi cadence to match visual pulse.",
      });
    }
  } else {
    operations.push({
      op_id: `op_${crypto.randomBytes(4).toString("hex")}`,
      op: "update_bible",
      target_id: revision.bible.project_id,
      field_path: "style_bible",
      before: revision.bible.style_bible,
      after: `${revision.bible.style_bible} ${instruction.trim().slice(0, 120)}`,
      rationale: "All scenes are canon-locked; proposed update on shared style bible only.",
    });
  }

  const patch: KrStoryPatch = {
    patch_id: `patch_${crypto.randomBytes(6).toString("hex")}`,
    project_id: revision.project_id,
    base_story_revision_id: revision.revision_id,
    status: "pending",
    summary: `Canon-safe patch for "${instruction.trim().slice(0, 80)}"`,
    operations,
    created_at: new Date().toISOString(),
  };

  return {
    patch,
    assistantMessage: `Prepared ${operations.length} structured diff operation(s) anchored to revision v${revision.version}. Locked canon scenes remain untouched. Review and Accept, Reject, or Rebase below.`,
  };
}

export function applyStoryPatchToBible(
  bible: KrStoryBible,
  patch: KrStoryPatch,
): KrStoryBible {
  const next: KrStoryBible = structuredClone(bible);

  for (const op of patch.operations) {
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
): { ok: true; rebasedPatch: KrStoryPatch } | { ok: false; conflictReason: string } {
  // Check whether any targeted field changed or became locked in latestRevision
  for (const op of stalePatch.operations) {
    if (op.op === "update_scene") {
      const scene = latestRevision.bible.scenes.find((s) => s.scene_id === op.target_id);
      if (!scene) {
        return { ok: false, conflictReason: `Target scene ${op.target_id} no longer exists in v${latestRevision.version}.` };
      }
      if (scene.locked_canon) {
        return { ok: false, conflictReason: `Target scene ${op.target_id} is now canon-locked in v${latestRevision.version}.` };
      }
      const field = op.field_path.split(".").pop() as keyof typeof scene | undefined;
      if (field && scene[field] !== op.before) {
        return {
          ok: false,
          conflictReason: `Field ${op.field_path} was already modified in v${latestRevision.version}.`,
        };
      }
    }
  }

  return {
    ok: true,
    rebasedPatch: {
      ...stalePatch,
      base_story_revision_id: latestRevision.revision_id,
      status: "rebased",
      summary: `${stalePatch.summary} (rebased to v${latestRevision.version})`,
    },
  };
}
