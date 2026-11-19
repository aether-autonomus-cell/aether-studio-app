-- Aether Studio v2.0 Optional Cloud Queue & Incremental OAuth Schema
-- Applied automatically when DATABASE_URL is configured (Mode B).

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
