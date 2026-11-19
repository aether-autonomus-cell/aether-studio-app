import type { HooksBundle, PackageBundle, ShortsArc } from "./hooks";
import type { AiRouteProvider, PairedTranslationOutput } from "./provider-router";
import type { ContentMode, LanguageCode, SceneGraphV1, StyleId } from "./schema";

export interface StudioStatusResponse {
  mode: "local-ready" | "cloud-ready";
  keyless_ai: boolean;
  oauth_configured: boolean;
  database_configured: boolean;
  owner_authenticated: boolean;
}

export type GenerateActionResponse<T> = {
  ok: true;
  route: AiRouteProvider;
  data: T;
  latencyMs: number;
  fallbackReason?: string;
  colabHint?: string;
};

export async function fetchStudioStatus(): Promise<StudioStatusResponse> {
  try {
    const res = await fetch("/api/2d/status", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as StudioStatusResponse;
  } catch {
    return {
      mode: "local-ready",
      keyless_ai: true,
      oauth_configured: false,
      database_configured: false,
      owner_authenticated: false,
    };
  }
}

export async function requestGenerateCompile(payload: {
  titleHi: string;
  titleEn: string;
  storyText: string;
  mode: ContentMode;
  aspectRatio: "9:16" | "16:9";
  visualMode: "pure-2d" | "hybrid-2d";
  styleId: StyleId;
  languages: LanguageCode[];
  colabOverrideJson?: string;
}): Promise<GenerateActionResponse<SceneGraphV1>> {
  const res = await fetch("/api/2d/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "compile", ...payload }),
  });
  if (!res.ok) {
    throw new Error(`Compile failed (HTTP ${res.status})`);
  }
  return (await res.json()) as GenerateActionResponse<SceneGraphV1>;
}

export async function requestGenerateTranslate(payload: {
  job: SceneGraphV1;
  colabOverrideJson?: string;
}): Promise<GenerateActionResponse<PairedTranslationOutput>> {
  const res = await fetch("/api/2d/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "translate", ...payload }),
  });
  if (!res.ok) throw new Error(`Translate failed (HTTP ${res.status})`);
  return (await res.json()) as GenerateActionResponse<PairedTranslationOutput>;
}

export async function requestGenerateHooks(payload: {
  topic: string;
  colabOverrideJson?: string;
}): Promise<GenerateActionResponse<HooksBundle>> {
  const res = await fetch("/api/2d/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "hooks", ...payload }),
  });
  if (!res.ok) throw new Error(`Hooks failed (HTTP ${res.status})`);
  return (await res.json()) as GenerateActionResponse<HooksBundle>;
}

export async function requestGeneratePackage(payload: {
  job: SceneGraphV1;
  colabOverrideJson?: string;
}): Promise<GenerateActionResponse<PackageBundle>> {
  const res = await fetch("/api/2d/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "package", ...payload }),
  });
  if (!res.ok) throw new Error(`Package failed (HTTP ${res.status})`);
  return (await res.json()) as GenerateActionResponse<PackageBundle>;
}

export async function requestGenerateShorts(payload: {
  job: SceneGraphV1;
  colabOverrideJson?: string;
}): Promise<GenerateActionResponse<ShortsArc>> {
  const res = await fetch("/api/2d/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "shorts", ...payload }),
  });
  if (!res.ok) throw new Error(`Shorts extraction failed (HTTP ${res.status})`);
  return (await res.json()) as GenerateActionResponse<ShortsArc>;
}

export interface CloudJobRecord {
  job_id: string;
  status: string;
  phase: string;
  packet_sha256: string;
  created_at: string;
  updated_at: string;
  report?: Record<string, unknown> | null;
  events?: { id: number; phase: string; message: string; created_at: string }[];
}

export async function createCloudJob(
  packet: SceneGraphV1,
  idempotencyKey: string,
): Promise<{ job: CloudJobRecord; pairingCode: string; expiresAt: string }> {
  const res = await fetch("/api/2d/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ packet }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return (await res.json()) as { job: CloudJobRecord; pairingCode: string; expiresAt: string };
}

export async function fetchCloudJob(jobId: string): Promise<CloudJobRecord> {
  const res = await fetch(`/api/2d/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Failed to fetch job (HTTP ${res.status})`);
  return (await res.json()) as CloudJobRecord;
}

export async function issueCloudPairingCode(
  jobId: string,
): Promise<{ pairingCode: string; expiresAt: string }> {
  const res = await fetch(`/api/2d/jobs/${encodeURIComponent(jobId)}/pair`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Pairing failed (HTTP ${res.status})`);
  return (await res.json()) as { pairingCode: string; expiresAt: string };
}

export async function cancelCloudJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/2d/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Cancel failed (HTTP ${res.status})`);
}
