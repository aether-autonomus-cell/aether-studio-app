# KathaRift Studio — Operations, Security & Database Migration Runbook

## 1. Database Policy (Durable Postgres vs Local Fixture)
- **Preview / Production (`VERCEL=1`, `VERCEL_ENV`, `NODE_ENV=production`, `GROK_PROJECT_ID`, `CI`):**
  - Requires `DATABASE_URL` pointing to durable PostgreSQL (e.g. Neon).
  - If `DATABASE_URL` is missing, the server **fails closed** with HTTP `503` (`code: "DB_NOT_CONFIGURED"`). Silent ephemeral PGLite fallback is strictly disabled in preview/production (even if `KR_LOCAL_FIXTURE_DB=true` is set).
- **Local Development:**
  - Unconfigured local runs also fail closed with `503 DB_NOT_CONFIGURED`.
  - Ephemeral in-memory PGLite is only enabled when explicitly started in local fixture mode (`KR_LOCAL_FIXTURE_DB=true`, e.g. `npm run dev:fixture`), and is visibly labelled `LOCAL_FIXTURE_EPHEMERAL_PGLITE` in server logs, `/api/kr/workspace` payloads, and the UI header banner.

## 2. Fail-Closed Server Authentication & Owner-Only Allowlist
- Server authentication (`src/server/katharift/auth-policy.ts`, `src/server/katharift/auth-guard.ts`, `src/lib/auth/verify.server.ts`, `src/lib/auth/server.ts`) **never** reads `VITE_AUTH_ENABLED`.
- Setting `VITE_AUTH_ENABLED=false` cannot disable or bypass server authentication.
- **Google OAuth + Owner-Only Allowlist (Recommended $0 Standalone Production Setup):**
  - `BETTER_AUTH_SECRET` (>= 16 chars)
  - `BETTER_AUTH_URL` (`https://aether-studio-app.vercel.app`)
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google Cloud OAuth Web Client with redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`)
  - `KR_OWNER_EMAIL` (server-side verified owner allowlist, e.g. `owner@gmail.com`; supports comma-separated `KR_ALLOWED_EMAILS` if needed)
- **Defense in Depth:**
  1. Missing `KR_OWNER_EMAIL` when Google OAuth is enabled fails closed (`401 AUTH_NOT_CONFIGURED`).
  2. Better Auth `databaseHooks.user.create.before` & `session.create.before` reject non-allowlisted or unverified emails before creating user/session rows.
  3. `requireUserId()` verifies `emailVerified === true`, `KR_OWNER_EMAIL` membership, and `"google"` account linkage on every `/api/kr/*` request (`403 OWNER_FORBIDDEN` for non-owners).
  4. All project/story/settings/job/timeline/export/pairing queries are scoped by `user_id`; cross-user access returns `404 PROJECT_NOT_FOUND`.

## 3. Controlled Database Migrations & Rollback
`npm run build` **does not** execute `npm run db:migrate`. PR Preview builds (`VERCEL_ENV=preview`) cannot mutate a shared or production database.

### Phone-Friendly Neon SQL Editor Bootstrap (No Terminal Required)
Run the reviewed, transaction-wrapped, idempotent SQL file `docs/sql/neon_bootstrap_v1_1.sql` in **Neon Console → SQL Editor**. It applies `0001_auth.sql` + `0002_katharift.sql` and records both in `_migrations` with `ON CONFLICT DO NOTHING`.

### CLI Inspection & Apply (Controlled Operator Step)
```bash
DATABASE_URL="postgres://..." npm run db:migrate:status -- --include-auth
DATABASE_URL="postgres://..." npm run db:migrate -- --include-auth
```
- `scripts/migrate.mjs` refuses to run apply/rollback if `VERCEL_ENV=preview`.

### Rollback KathaRift Schema (`0002_katharift.sql`)
```bash
DATABASE_URL="postgres://..." npm run db:rollback -- 0002_katharift.sql
```
This runs `migrations/down/0002_katharift.down.sql` and removes the `0002_katharift.sql` row from `_migrations` inside a single PostgreSQL transaction (without touching Better Auth tables).
