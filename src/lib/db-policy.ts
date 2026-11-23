export type DbSource = "neon" | "pglite";
export type DbRuntimeMode = "neon" | "local_fixture_pglite" | "unconfigured";

export class DatabaseConfigurationError extends Error {
  readonly status = 503;
  readonly code = "DB_NOT_CONFIGURED";
  readonly dbMode = "unconfigured" as const;

  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

function isTruthyFlag(val: string | undefined): boolean {
  const v = val?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * True whenever the process is running in a preview, staging, CI, or
 * production deployment environment where silent ephemeral storage is unsafe.
 */
export function isPreviewOrProductionEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (isTruthyFlag(env.VERCEL)) return true;
  if (env.VERCEL_ENV?.trim()) return true;
  if (env.VERCEL_URL?.trim()) return true;
  if (env.NODE_ENV?.trim() === "production") return true;
  if (env.GROK_PROJECT_ID?.trim()) return true;
  if (isTruthyFlag(env.CI)) return true;
  return false;
}

export type DbPolicy =
  | {
      mode: "neon";
      dbSource: "neon";
      isEphemeralFixture: false;
      label: "durable-postgres";
      databaseUrl: string;
    }
  | {
      mode: "local_fixture_pglite";
      dbSource: "pglite";
      isEphemeralFixture: true;
      label: "LOCAL_FIXTURE_EPHEMERAL_PGLITE";
    }
  | {
      mode: "unconfigured";
      dbSource: null;
      isEphemeralFixture: false;
      label: "unconfigured";
      reason: string;
    };

/**
 * Resolve database mode:
 * - Durable Postgres (`neon`) whenever `DATABASE_URL` is non-empty.
 * - Ephemeral in-memory PGLite (`local_fixture_pglite`) ONLY in non-preview,
 *   non-production local runs with explicit `KR_LOCAL_FIXTURE_DB=true`.
 * - Otherwise `unconfigured` (fail closed with `DatabaseConfigurationError`).
 */
export function resolveDbPolicy(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): DbPolicy {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return {
      mode: "neon",
      dbSource: "neon",
      isEphemeralFixture: false,
      label: "durable-postgres",
      databaseUrl,
    };
  }

  if (isPreviewOrProductionEnv(env)) {
    return {
      mode: "unconfigured",
      dbSource: null,
      isEphemeralFixture: false,
      label: "unconfigured",
      reason:
        "Durable PostgreSQL database is not configured (DATABASE_URL is missing). " +
        "Silent ephemeral PGLite fallback is disabled in preview/production environments.",
    };
  }

  if (isTruthyFlag(env.KR_LOCAL_FIXTURE_DB)) {
    return {
      mode: "local_fixture_pglite",
      dbSource: "pglite",
      isEphemeralFixture: true,
      label: "LOCAL_FIXTURE_EPHEMERAL_PGLITE",
    };
  }

  return {
    mode: "unconfigured",
    dbSource: null,
    isEphemeralFixture: false,
    label: "unconfigured",
    reason:
      "Durable PostgreSQL database is not configured (DATABASE_URL is missing). " +
      "Set DATABASE_URL for durable Postgres, or set KR_LOCAL_FIXTURE_DB=true " +
      "(e.g. `npm run dev:fixture`) for explicitly labelled ephemeral local fixture mode.",
  };
}
