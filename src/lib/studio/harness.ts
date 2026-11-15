/** Coding discipline & agent harness rules inspired by ECC and Ponytail. */

export const ECC_RULES = [
  "Keep diffs minimal, cohesive, and free of speculative abstractions.",
  "Never introduce silent data corruption or drop chapter endings.",
  "Prefer deterministic fallbacks over throwing unhandled errors to the UI.",
  "Keep secrets strictly in volatile tab memory; never persist keys or cookies.",
] as const;

export const PONYTAIL_RULES = [
  "Single source of truth per schema and type contract.",
  "Bounded retries, bounded loops, and explicit circuit breakers on external calls.",
  "Pure, testable helper functions decoupled from framework server wrappers.",
] as const;

export type HarnessCheckResult = {
  ok: boolean;
  violations: string[];
};

const SECRET_PATTERNS = [
  /\b(?:AIza[0-9A-Za-z_-]{30,}|sk-[0-9A-Za-z]{20,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,})\b/,
];

export function buildAgentHarnessPrompt(): string {
  return [
    "Harness discipline (ECC + Ponytail):",
    "Return concise, deterministic, over-engineering-free outputs.",
    "Never loop or repeat identical tool calls.",
    "Preserve exact character and scene IDs.",
  ].join(" ");
}

export function validatePatchDiscipline(text: string): HarnessCheckResult {
  const violations: string[] = [];
  if (!text.trim()) violations.push("Empty output.");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      violations.push("Output appears to contain a raw credential token.");
      break;
    }
  }
  return { ok: violations.length === 0, violations };
}

export function clampText(value: string, maxChars: number): string {
  const clean = value.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
