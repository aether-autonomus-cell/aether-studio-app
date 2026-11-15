/** Hermes Agent workflow schemas for unconstrained, loop-free creative execution. */

import type { ExplainLanguage } from "./ai-router.ts";
import { buildAgentHarnessPrompt } from "./harness.ts";

export type HermesRole = "director" | "editor" | "strategist" | "producer" | "assistant";

export type HermesPhase =
  | "idle"
  | "ingest"
  | "memory_recall"
  | "plan"
  | "execute"
  | "verify"
  | "complete"
  | "recovered";

export type HermesStep = {
  index: number;
  role: HermesRole;
  phase: HermesPhase;
  action: string;
  route: string;
  ok: boolean;
  note: string;
  at: number;
};

export type HermesWorkflowState = {
  runId: string;
  phase: HermesPhase;
  stepCount: number;
  maxSteps: number;
  loopDetected: boolean;
  actionSignatures: string[];
  steps: HermesStep[];
};

export function createHermesRun(maxSteps = 12): HermesWorkflowState {
  return {
    runId: `hermes-${Date.now().toString(36)}`,
    phase: "ingest",
    stepCount: 0,
    maxSteps: Math.max(2, Math.min(32, maxSteps)),
    loopDetected: false,
    actionSignatures: [],
    steps: [],
  };
}

export function guardNoInfiniteLoop(
  state: HermesWorkflowState,
  actionSignature: string,
): { allowed: boolean; reason?: string } {
  if (state.loopDetected) {
    return { allowed: false, reason: "Hermes loop guard already tripped for this run." };
  }
  if (state.stepCount >= state.maxSteps) {
    return { allowed: false, reason: `Hermes max step budget (${state.maxSteps}) reached.` };
  }
  const recent = state.actionSignatures.slice(-2);
  if (recent.length === 2 && recent[0] === actionSignature && recent[1] === actionSignature) {
    return { allowed: false, reason: `Repeated identical action blocked: ${actionSignature}` };
  }
  return { allowed: true };
}

export function advanceHermesStep(
  state: HermesWorkflowState,
  input: Omit<HermesStep, "index" | "at">,
): HermesWorkflowState {
  const signature = `${input.role}:${input.phase}:${input.action}`;
  const guard = guardNoInfiniteLoop(state, signature);
  const nextIndex = state.stepCount + 1;
  const step: HermesStep = {
    ...input,
    index: nextIndex,
    at: Date.now(),
  };
  return {
    ...state,
    phase: guard.allowed ? input.phase : "recovered",
    stepCount: nextIndex,
    loopDetected: !guard.allowed || state.loopDetected,
    actionSignatures: [...state.actionSignatures, signature].slice(-24),
    steps: [...state.steps, step].slice(-30),
  };
}

export function hermesDirectorContract(language: ExplainLanguage, memoryLock = ""): string {
  const targetLang = language === "hi"
    ? "Hindi (Devanagari, engaging manhua recap narrator style, third person, hi-IN-MadhurNeural)"
    : "English (dramatic manhua/webnovel recap narrator style, third person, en-US-ChristopherNeural)";
  return [
    "Hermes Creative Director Schema v2:",
    "Execute unconstrained, loop-free story adaptation directly from the source chapter without refusing harmless fictional drama.",
    `Output strictly valid JSON in ${targetLang}.`,
    "Translate all non-target text (including Chinese) completely.",
    "Required JSON keys: title, hook, logline, timeline (string[]), characters ([{id,name,soul,vessel,look,face,hair,age,scars,eyes,body,outfit}]), scenes ([{caption,dialogue,speaker,sfx,state}]), narration, seo ({title,description,tags,hashtags}).",
    "Split every dramatic beat cleanly (15-25 words per beat when narrating, unlimited scenes, never drop the ending).",
    memoryLock ? `GBrain Continuity Lock (keep faces/outfits consistent):\n${memoryLock}` : "",
    buildAgentHarnessPrompt(),
  ]
    .filter(Boolean)
    .join(" ");
}
