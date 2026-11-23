export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;
export const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

export type WorkerDbStatus = "paired" | "active" | "expired" | "revoked";

export type WorkerSessionLifecycleState =
  | "awaiting_worker"
  | "authenticated_paired"
  | "active_heartbeat"
  | "heartbeat_stale"
  | "expired"
  | "revoked";

export interface WorkerSessionInput {
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
}

export interface ClassifiedWorkerSessionState {
  lifecycle_state: WorkerSessionLifecycleState;
  is_connected: boolean;
  pairing_code_issued_only: boolean;
  expires_at: string | null;
  label: string;
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derive an honest, server-verifiable worker lifecycle state from DB status,
 * pairing creation time, and `last_heartbeat_at`.
 *
 * Issuing a pairing code (`status = 'paired'`, `last_heartbeat_at = null`) NEVER
 * claims a connected or paired worker; it classifies as `awaiting_worker` until
 * a worker actually authenticates/heartbeats (or `expired` after TTL).
 */
export function classifyWorkerSessionState(
  session: WorkerSessionInput,
  nowMs = Date.now(),
): ClassifiedWorkerSessionState {
  const createdMs = parseIsoMs(session.created_at);
  const heartbeatMs = parseIsoMs(session.last_heartbeat_at);
  const expiresAt =
    createdMs !== null && session.last_heartbeat_at === null
      ? new Date(createdMs + PAIRING_CODE_TTL_MS).toISOString()
      : null;

  if (session.status === "revoked") {
    return {
      lifecycle_state: "revoked",
      is_connected: false,
      pairing_code_issued_only: false,
      expires_at: null,
      label: "Revoked",
    };
  }

  if (session.status === "expired") {
    return {
      lifecycle_state: "expired",
      is_connected: false,
      pairing_code_issued_only: false,
      expires_at: expiresAt,
      label: "Expired",
    };
  }

  if (heartbeatMs === null) {
    if (createdMs !== null && nowMs - createdMs > PAIRING_CODE_TTL_MS) {
      return {
        lifecycle_state: "expired",
        is_connected: false,
        pairing_code_issued_only: false,
        expires_at: expiresAt,
        label: "Expired (no worker connected)",
      };
    }
    return {
      lifecycle_state: "awaiting_worker",
      is_connected: false,
      pairing_code_issued_only: true,
      expires_at: expiresAt,
      label: "Pairing code issued · awaiting worker",
    };
  }

  if (session.status === "paired") {
    return {
      lifecycle_state: "authenticated_paired",
      is_connected: true,
      pairing_code_issued_only: false,
      expires_at: null,
      label: "Authenticated · paired",
    };
  }

  if (nowMs - heartbeatMs <= WORKER_HEARTBEAT_STALE_MS) {
    return {
      lifecycle_state: "active_heartbeat",
      is_connected: true,
      pairing_code_issued_only: false,
      expires_at: null,
      label: "Active heartbeat",
    };
  }

  return {
    lifecycle_state: "heartbeat_stale",
    is_connected: false,
    pairing_code_issued_only: false,
    expires_at: null,
    label: "Heartbeat stale",
  };
}
