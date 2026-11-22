# KathaRift Studio — Operations, Security & Database Migration Runbook

## 1. Database Policy (Durable Postgres vs Local Fixture)
- **Preview / Production (`VERCEL=1`, `VERCEL_ENV`, `NODE_ENV=production`, `GROK_PROJECT_ID`, `CI`):**
  - Requires `DATABASE_URL` pointing to durable PostgreSQL (e.g. Neon).
  - If `DATABASE_URL` is missing, the server **fails closed** with HTTP `503` (`code: "DB_NOT_CONFIGURED"`). Silent ephemeral PGLite fallback is strictly disabled in preview/production (even if `KR_LOCAL_FIXTURE_DB=true` is set).
- **Local Development:**
  - Unconfigured local runs also fail closed with `503 DB_NOT_CONFIGURED`.
  - Ephemeral in-memory PGLite is only enabled when explicitly started in local fixture mode (`KR_LOCAL_FIXTURE_DB=true`, e.g. `npm run dev:fixture`), and is visibly labelled `LOCAL_FIXTURE_EPHEMERAL_PGLITE` in server logs, `/api/kr/workspace` payloads, and the UI header banner.

## 2. Fail-Closed Server Authentication
- Server authentication (`src/server/katharift/auth-policy.ts`, `src/server/katharift/auth-guard.ts`, `src/lib/auth/verify.server.ts`) **never** reads `VITE_AUTH_ENABLED`.
- Setting `VITE_AUTH_ENABLED=false` cannot disable or bypass server authentication.
- Required server secrets:
  - `BETTER_AUTH_SECRET` (>= 16 chars)
  - `GROK_AUTH_CLIENT_ID` and `GROK_AUTH_CLIENT_SECRET` (or explicit `GROK_PROJECT_ID` / `GROK_GATE_ORIGIN` when behind Grok Gate)
  - `BETTER_AUTH_URL` (recommended for deployed origins)
- When any required auth secret is missing or a request has no valid session/bearer/gate token, `/api/kr/*` rejects with HTTP `401`.
- All project/story/settings/job/timeline/export/pairing queries are scoped by `user_id`; cross-user access returns `404 PROJECT_NOT_FOUND`.

## 3. Controlled Database Migrations & Rollback
`npm run build` **does not** execute `npm run db:migrate`. PR Preview builds (`VERCEL_ENV=preview`) cannot mutate a shared or production database.

### Inspect Pending Migrations (Read-Only)
```bash
DATABASE_URL="postgres://..." npm run db:migrate:status
```

### Apply Migrations (Controlled Operator Step)
```bash
DATABASE_URL="postgres://..." npm run db:migrate
```
- `scripts/migrate.mjs` refuses to run apply/rollback if `VERCEL_ENV=preview`.
- Copy `migrations/auth/0001_auth.sql` to `migrations/0001_auth.sql` only when Better Auth tables are not yet provisioned in the target database.

### Rollback KathaRift Schema (`0002_katharift.sql`)
```bash
DATABASE_URL="postgres://..." npm run db:rollback -- 0002_katharift.sql
```
This runs `migrations/down/0002_katharift.down.sql` and removes the `0002_katharift.sql` row from `_migrations` inside a single PostgreSQL transaction.
