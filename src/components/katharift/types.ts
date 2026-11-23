import { getBearerToken } from "@/lib/auth/client";
import type {
  KrJobV1,
  KrSettingsRevision,
  KrSkillTraceEntry,
  KrStoryPatch,
  KrStoryRevision,
  KrTimelineV1,
  KrWorkerEvent,
} from "@/packages/contracts/schemas";
import type { SkillRegistryReport } from "@/packages/skill-runtime/registry";

export type PrimaryTab = "story" | "production" | "editor" | "exports";
export type StudioDrawer = "none" | "settings" | "canon" | "assets" | "connections" | "activity";

export interface WorkspaceSnapshot {
  runtime?: {
    db_mode: "neon" | "local_fixture_pglite" | "unconfigured";
    is_ephemeral_fixture: boolean;
    label: string;
  };
  project: {
    project_id: string;
    title: string;
    logline: string;
    current_story_revision_id: string;
    current_settings_revision_id: string;
    current_timeline_revision_id: string;
    version: number;
    updated_at: string;
  };
  storyRevision: KrStoryRevision;
  settingsRevision: KrSettingsRevision;
  timelineRevisionId: string;
  timeline: KrTimelineV1;
  patches: KrStoryPatch[];
  jobs: KrJobV1[];
  workerSessions: Array<{
    worker_session_id: string;
    runtime_kind: string;
    status: string;
    gpu_name: string | null;
    last_heartbeat_at: string | null;
    created_at: string;
  }>;
  workerEvents: KrWorkerEvent[];
  exports: Array<{
    export_id: string;
    timeline_revision_id: string;
    format: string;
    status: string;
    drive_file_id: string | null;
    file_name: string;
    byte_size: number;
    checksum_sha256: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  connections: Array<{
    connection_id: string;
    provider: string;
    status: string;
    account_label: string | null;
    secret_preview: string | null;
    verified_at: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
  skillTraces: KrSkillTraceEntry[];
  skillsReport: SkillRegistryReport;
  adapters: Array<{
    adapter_id: string;
    kind: string;
    status: string;
    detail: string;
  }>;
}

export async function krApiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getBearerToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`) as Error & {
      status?: number;
      payload?: unknown;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}
