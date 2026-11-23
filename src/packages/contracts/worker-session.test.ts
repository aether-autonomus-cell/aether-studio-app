import test from "node:test";
import assert from "node:assert/strict";
import {
  PAIRING_CODE_TTL_MS,
  WORKER_HEARTBEAT_STALE_MS,
  classifyWorkerSessionState,
} from "./worker-session.ts";

test("classifyWorkerSessionState separates unredeemed pairing codes from connected workers", () => {
  const createdAt = "2026-11-23T10:00:00.000Z";
  const nowWithinTtl = Date.parse(createdAt) + 2 * 60_000;

  // Newly issued pairing code has status='paired' in DB and last_heartbeat_at=null -> MUST NOT say connected/paired
  const awaiting = classifyWorkerSessionState(
    { status: "paired", last_heartbeat_at: null, created_at: createdAt },
    nowWithinTtl,
  );
  assert.equal(awaiting.lifecycle_state, "awaiting_worker");
  assert.equal(awaiting.is_connected, false);
  assert.equal(awaiting.pairing_code_issued_only, true);
  assert.match(awaiting.label, /awaiting worker/i);

  // After 15m TTL with no worker heartbeat -> expired
  const expired = classifyWorkerSessionState(
    { status: "paired", last_heartbeat_at: null, created_at: createdAt },
    Date.parse(createdAt) + PAIRING_CODE_TTL_MS + 1000,
  );
  assert.equal(expired.lifecycle_state, "expired");
  assert.equal(expired.is_connected, false);

  // Worker authenticated (last_heartbeat_at present) with status='paired' -> authenticated_paired
  const authed = classifyWorkerSessionState(
    {
      status: "paired",
      last_heartbeat_at: "2026-11-23T10:01:00.000Z",
      created_at: createdAt,
    },
    nowWithinTtl,
  );
  assert.equal(authed.lifecycle_state, "authenticated_paired");
  assert.equal(authed.is_connected, true);

  // Active worker with fresh heartbeat -> active_heartbeat
  const active = classifyWorkerSessionState(
    {
      status: "active",
      last_heartbeat_at: "2026-11-23T10:01:30.000Z",
      created_at: createdAt,
    },
    nowWithinTtl,
  );
  assert.equal(active.lifecycle_state, "active_heartbeat");
  assert.equal(active.is_connected, true);

  // Active worker with stale heartbeat (>3m) -> heartbeat_stale
  const stale = classifyWorkerSessionState(
    {
      status: "active",
      last_heartbeat_at: "2026-11-23T10:01:00.000Z",
      created_at: createdAt,
    },
    Date.parse("2026-11-23T10:01:00.000Z") + WORKER_HEARTBEAT_STALE_MS + 5000,
  );
  assert.equal(stale.lifecycle_state, "heartbeat_stale");
  assert.equal(stale.is_connected, false);

  // Revoked -> revoked
  const revoked = classifyWorkerSessionState(
    {
      status: "revoked",
      last_heartbeat_at: null,
      created_at: createdAt,
    },
    nowWithinTtl,
  );
  assert.equal(revoked.lifecycle_state, "revoked");
  assert.equal(revoked.is_connected, false);
});
