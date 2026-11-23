-- KathaRift Studio v1.1 Canonical Schema
-- Reversible via migrations/down/0002_katharift.down.sql

CREATE TABLE IF NOT EXISTS kr_projects (
  project_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  logline TEXT NOT NULL,
  current_story_revision_id TEXT,
  current_settings_revision_id TEXT,
  current_timeline_revision_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kr_projects_user ON kr_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS kr_story_revisions (
  revision_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_revision_id TEXT,
  summary TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  bible_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS kr_story_patches (
  patch_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  base_story_revision_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'rebased')),
  summary TEXT NOT NULL,
  operations_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kr_settings_revisions (
  settings_revision_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS kr_timeline_revisions (
  timeline_revision_id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_timeline_revision_id TEXT,
  action_label TEXT NOT NULL,
  timeline_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(timeline_id, version)
);

CREATE INDEX IF NOT EXISTS idx_kr_timeline_proj ON kr_timeline_revisions(project_id, version DESC);

CREATE TABLE IF NOT EXISTS kr_jobs (
  job_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  story_revision_id TEXT NOT NULL,
  settings_revision_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  confirmed_by_user BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'running', 'paused_quota', 'paused_user', 'failed', 'completed', 'cancelled')),
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  worker_session_id TEXT,
  current_scene_index INTEGER NOT NULL DEFAULT 0,
  job_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_kr_jobs_project ON kr_jobs(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS kr_worker_sessions (
  worker_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  pairing_code_hash TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('colab_free_gpu', 'local_python_worker')),
  status TEXT NOT NULL CHECK (status IN ('paired', 'active', 'expired', 'revoked')),
  gpu_name TEXT,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kr_worker_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES kr_jobs(job_id) ON DELETE CASCADE,
  worker_session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  scene_id TEXT,
  stage TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, seq)
);

CREATE TABLE IF NOT EXISTS kr_exports (
  export_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES kr_projects(project_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  timeline_revision_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('mp4_hi', 'mp4_en', 'srt_hi', 'srt_en', 'bundle_json')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  drive_file_id TEXT,
  file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kr_connections (
  connection_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'google_gemini_free', 'groq_free', 'openrouter_free')),
  status TEXT NOT NULL CHECK (status IN ('disconnected', 'configured', 'verified', 'quota_paused', 'error')),
  account_label TEXT,
  encrypted_secret TEXT,
  verified_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS kr_skill_traces (
  trace_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  skill_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'rejected', 'blocked_licence', 'unavailable')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
