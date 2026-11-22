import {
  FREE_ROUTE_ALLOWLIST,
  type FreeRouteId,
  type ZeroSpendPolicy,
} from "../contracts/schemas.ts";
import { loadTaskInstructions } from "../skill-runtime/instructions.ts";
import { dispatchSkillTool } from "../skill-runtime/dispatcher.ts";
import type { KrSkillTraceEntry } from "../contracts/schemas.ts";

export interface DirectorRouteDecision {
  ok: boolean;
  route: FreeRouteId;
  status: "ok" | "quota_paused" | "rejected_paid_route";
  reason: string;
}

/**
 * First-party KathaRiftDirectorRouter (replaces incompatible monolithic OmniRoute gateway).
 * Enforces paid_routes=false server-side and explicit free-route allowlist with pause-on-quota.
 */
export function evaluateDirectorRoute(
  requestedRoute: string,
  policy: ZeroSpendPolicy,
  opts?: { simulatedQuotaExhausted?: boolean },
): DirectorRouteDecision {
  if (policy.paid_routes !== false || policy.allow_billing_fallback !== false) {
    return {
      ok: false,
      route: "deterministic-local-director",
      status: "rejected_paid_route",
      reason: "Zero-spend enforcement rejected request: paid_routes and allow_billing_fallback must be false.",
    };
  }

  const allowed = new Set<string>(policy.allowed_free_routes);
  if (
    !FREE_ROUTE_ALLOWLIST.includes(requestedRoute as FreeRouteId) ||
    !allowed.has(requestedRoute)
  ) {
    return {
      ok: false,
      route: "deterministic-local-director",
      status: "rejected_paid_route",
      reason: `Route '${requestedRoute}' is outside the verified free-route allowlist.`,
    };
  }

  if (opts?.simulatedQuotaExhausted) {
    return {
      ok: false,
      route: requestedRoute as FreeRouteId,
      status: "quota_paused",
      reason: `Free-tier quota exhausted on '${requestedRoute}'. Production paused per zero-spend policy (no paid fallback).`,
    };
  }

  return {
    ok: true,
    route: requestedRoute as FreeRouteId,
    status: "ok",
    reason: `Verified free route '${requestedRoute}' active.`,
  };
}

export interface DirectorGuidanceContext {
  instructionsLoaded: Array<{ skill_id: string; file_path: string; spdx_license: string }>;
  skillTraces: KrSkillTraceEntry[];
}

export function gatherDirectorGuidance(
  openingHookText: string,
  storyTitle: string,
  lines: Array<{ id: string; text: string; spoken: string; hero: string }>,
): DirectorGuidanceContext {
  const storyDocs = loadTaskInstructions("story", 1200);
  const directorDocs = loadTaskInstructions("director", 1200);
  const instructionsLoaded = [...storyDocs, ...directorDocs].map((d) => ({
    skill_id: d.skill_id,
    file_path: d.file_path,
    spdx_license: d.spdx_license,
  }));

  const traces: KrSkillTraceEntry[] = [];
  if (openingHookText.trim()) {
    const hookRes = dispatchSkillTool("youtube_score_hooks", { hook: openingHookText });
    traces.push(hookRes.trace);
  }
  if (lines.length > 0) {
    const beatRes = dispatchSkillTool("cinematic_lint_beats", {
      title: storyTitle,
      lines: lines.map((l) => ({ ...l, typed: "", gap_after: 0.45 })),
    });
    traces.push(beatRes.trace);
  }

  return { instructionsLoaded, skillTraces: traces };
}
