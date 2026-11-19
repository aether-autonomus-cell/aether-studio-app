import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { env } from "@/lib/env.server";
import { canonicalJson, sha256Hex, type SceneGraphV1 } from "@/lib/studio/schema";
import { generateLeaseToken, generatePairingCode, hashPairingCode } from "./worker-auth";

let poolInstance: Pool | null = null;
let schemaEnsured = false;

function getPool(): Pool {
  const databaseUrl = env("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString: databaseUrl });
  }
  return poolInstance;
}

async function ensureSchema(pool: Pool): Promise<void> {
  if (schemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS studio_2d_jobs (
      job_id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      owner_sub TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'PREFLIGHT',
      packet_json JSONB NOT NULL,
      packet_sha256 TEXT NOT NULL,
      report_json JSONB,
      lease_token TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS studio_2d_pairing_codes (
      code_hash TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES studio_2d_jobs(job_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS studio_2d_events (
      id BIGSERIAL PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES studio_2d_jobs(job_id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS studio_2d_publish_intents (
      intent_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES studio_2d_jobs(job_id) ON DELETE CASCADE,
      channel_slot TEXT NOT NULL,
      language TEXT NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      metadata_sha256 TEXT NOT NULL,
      privacy_status TEXT NOT NULL DEFAULT 'private',
      youtube_video_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS studio_2d_oauth_tokens (
      channel_slot TEXT PRIMARY KEY,
      owner_sub TEXT NOT NULL,
      scopes TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL,
      channel_title TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

export async function createOrReuseJob(opts: {
  ownerSub: string;
  packet: SceneGraphV1;
  idempotencyKey?: string;
}) {
  const pool = getPool();
  await ensureSchema(pool);
  const packetSha = await sha256Hex(canonicalJson(opts.packet));

  if (opts.idempotencyKey) {
    const existing = await pool.query(
      "SELECT * FROM studio_2d_jobs WHERE idempotency_key = $1 AND owner_sub = $2 LIMIT 1",
      [opts.idempotencyKey, opts.ownerSub],
    );
    if (existing.rows[0]) {
      const pairing = await issuePairingForJob(existing.rows[0].job_id as string, opts.ownerSub);
      return { job: existing.rows[0], ...pairing };
    }
  }

  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const res = await pool.query(
    `INSERT INTO studio_2d_jobs (job_id, idempotency_key, owner_sub, status, phase, packet_json, packet_sha256)
     VALUES ($1, $2, $3, 'queued', 'PREFLIGHT', $4::jsonb, $5)
     RETURNING *`,
    [jobId, opts.idempotencyKey ?? null, opts.ownerSub, JSON.stringify(opts.packet), packetSha],
  );
  await pool.query(
    "INSERT INTO studio_2d_events (job_id, phase, message) VALUES ($1, 'PREFLIGHT', 'Cloud job snapshot created')",
    [jobId],
  );
  const pairing = await issuePairingForJob(jobId, opts.ownerSub);
  return { job: res.rows[0], ...pairing };
}

export async function listOwnerJobs(ownerSub: string) {
  const pool = getPool();
  await ensureSchema(pool);
  const res = await pool.query(
    "SELECT job_id, status, phase, packet_sha256, report_json, created_at, updated_at FROM studio_2d_jobs WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 20",
    [ownerSub],
  );
  return res.rows;
}

export async function getOwnerJob(jobId: string, ownerSub: string) {
  const pool = getPool();
  await ensureSchema(pool);
  const res = await pool.query(
    "SELECT * FROM studio_2d_jobs WHERE job_id = $1 AND owner_sub = $2 LIMIT 1",
    [jobId, ownerSub],
  );
  if (!res.rows[0]) return null;
  const events = await pool.query(
    "SELECT id, phase, message, created_at FROM studio_2d_events WHERE job_id = $1 ORDER BY id DESC LIMIT 40",
    [jobId],
  );
  return { ...res.rows[0], events: events.rows };
}

export async function issuePairingForJob(jobId: string, ownerSub: string) {
  const pool = getPool();
  await ensureSchema(pool);
  const ownerCheck = await pool.query(
    "SELECT job_id FROM studio_2d_jobs WHERE job_id = $1 AND owner_sub = $2 LIMIT 1",
    [jobId, ownerSub],
  );
  if (!ownerCheck.rows[0]) throw new Error("Job not found");
  const { code, codeHash, expiresAt } = generatePairingCode();
  await pool.query(
    "INSERT INTO studio_2d_pairing_codes (code_hash, job_id, expires_at) VALUES ($1, $2, $3)",
    [codeHash, jobId, expiresAt.toISOString()],
  );
  return { pairingCode: code, expiresAt: expiresAt.toISOString() };
}

export async function cancelOwnerJob(jobId: string, ownerSub: string) {
  const pool = getPool();
  await ensureSchema(pool);
  const res = await pool.query(
    `UPDATE studio_2d_jobs SET status = 'cancelled', updated_at = now()
     WHERE job_id = $1 AND owner_sub = $2 AND status IN ('queued', 'running')
     RETURNING job_id, status`,
    [jobId, ownerSub],
  );
  return res.rows[0] ?? null;
}

export async function claimJobWithPairingCode(code: string) {
  const pool = getPool();
  await ensureSchema(pool);
  const codeHash = hashPairingCode(code);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `UPDATE studio_2d_pairing_codes
       SET consumed_at = now()
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING job_id`,
      [codeHash],
    );
    if (!claim.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const jobId = claim.rows[0].job_id as string;
    const leaseToken = generateLeaseToken();
    const jobRes = await client.query(
      `UPDATE studio_2d_jobs
       SET status = 'running', phase = 'PREFLIGHT', lease_token = $2, lease_expires_at = now() + interval '4 hours', updated_at = now()
       WHERE job_id = $1 AND status <> 'cancelled'
       RETURNING *`,
      [jobId, leaseToken],
    );
    if (!jobRes.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "INSERT INTO studio_2d_events (job_id, phase, message) VALUES ($1, 'PREFLIGHT', 'Colab worker claimed job lease')",
      [jobId],
    );
    await client.query("COMMIT");
    return { job: jobRes.rows[0], leaseToken };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function recordWorkerHeartbeat(opts: {
  jobId: string;
  leaseToken: string;
  phase: string;
  message: string;
}) {
  const pool = getPool();
  await ensureSchema(pool);
  const res = await pool.query(
    `UPDATE studio_2d_jobs
     SET phase = $3, updated_at = now()
     WHERE job_id = $1 AND lease_token = $2 AND status = 'running'
     RETURNING job_id`,
    [opts.jobId, opts.leaseToken, opts.phase],
  );
  if (!res.rows[0]) return false;
  await pool.query(
    "INSERT INTO studio_2d_events (job_id, phase, message) VALUES ($1, $2, $3)",
    [opts.jobId, opts.phase, opts.message.slice(0, 500)],
  );
  return true;
}

export async function completeWorkerJob(opts: {
  jobId: string;
  leaseToken: string;
  status: "saved" | "failed";
  report: Record<string, unknown>;
}) {
  const pool = getPool();
  await ensureSchema(pool);
  const phase = opts.status === "saved" ? "SAVED" : "FAILED";
  const res = await pool.query(
    `UPDATE studio_2d_jobs
     SET status = $3, phase = $4, report_json = $5::jsonb, updated_at = now()
     WHERE job_id = $1 AND lease_token = $2
     RETURNING job_id, status`,
    [opts.jobId, opts.leaseToken, opts.status, phase, JSON.stringify(opts.report)],
  );
  if (!res.rows[0]) return false;
  await pool.query(
    "INSERT INTO studio_2d_events (job_id, phase, message) VALUES ($1, $2, $3)",
    [opts.jobId, phase, `Worker finished with status ${opts.status}`],
  );
  return true;
}

export async function createPublishIntent(opts: {
  jobId: string;
  channelSlot: "hindi" | "english";
  language: string;
  artifactSha256: string;
  metadataSha256: string;
  privacyStatus: string;
}) {
  const pool = getPool();
  await ensureSchema(pool);
  const intentId = `pub_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const res = await pool.query(
    `INSERT INTO studio_2d_publish_intents
     (intent_id, job_id, channel_slot, language, artifact_sha256, metadata_sha256, privacy_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      intentId,
      opts.jobId,
      opts.channelSlot,
      opts.language,
      opts.artifactSha256,
      opts.metadataSha256,
      opts.privacyStatus,
    ],
  );
  return res.rows[0];
}

export async function upsertEncryptedOAuthToken(opts: {
  channelSlot: "hindi" | "english";
  ownerSub: string;
  scopes: string;
  encryptedRefreshToken: string;
  channelTitle?: string;
}) {
  const pool = getPool();
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO studio_2d_oauth_tokens (channel_slot, owner_sub, scopes, encrypted_refresh_token, channel_title, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (channel_slot) DO UPDATE SET
       owner_sub = EXCLUDED.owner_sub,
       scopes = EXCLUDED.scopes,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       channel_title = EXCLUDED.channel_title,
       updated_at = now()`,
    [opts.channelSlot, opts.ownerSub, opts.scopes, opts.encryptedRefreshToken, opts.channelTitle ?? null],
  );
}
