import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import {
  DatabaseConfigurationError,
  resolveDbPolicy,
  type DbPolicy,
  type DbSource,
} from "./db-policy.ts";

export { DatabaseConfigurationError, resolveDbPolicy, type DbPolicy, type DbSource };

export function getDbPolicy(): DbPolicy {
  return resolveDbPolicy(typeof process !== "undefined" ? process.env : {});
}

const initialPolicy = getDbPolicy();

/** Active database source when configured (`null` when unconfigured). */
export const dbSource: DbSource | null = initialPolicy.dbSource;

export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgSqlUrl__?: string;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __krFixtureWarningLogged__?: boolean;
};

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(databaseUrl: string): Promise<Sql> {
  if (globalRef.__pgSqlUrl__ !== databaseUrl) {
    globalRef.__pgSqlPromise__ = undefined;
    globalRef.__pgSqlUrl__ = databaseUrl;
  }
  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString: databaseUrl });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  if (!globalRef.__krFixtureWarningLogged__) {
    globalRef.__krFixtureWarningLogged__ = true;
    console.warn(
      "[db] LOCAL_FIXTURE_EPHEMERAL_PGLITE active (KR_LOCAL_FIXTURE_DB=true). " +
        "Data is ephemeral and resets on process restart.",
    );
  }

  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  const migrate = async (): Promise<void> => {
    let migrations: Record<string, string> = {};
    if (typeof import.meta.glob === "function") {
      migrations = import.meta.glob("/migrations/*.sql", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>;
    } else {
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const dir = join(process.cwd(), "migrations");
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith(".sql")) {
          migrations[`/migrations/${entry}`] = readFileSync(join(dir, entry), "utf8");
        }
      }
    }

    const doneRows = await pg.query<{ name: string }>("select name from _migrations");
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined)
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  const policy = getDbPolicy();
  if (policy.mode === "unconfigured") {
    throw new DatabaseConfigurationError(policy.reason);
  }
  if (policy.mode === "neon") {
    return createNeonSql(policy.databaseUrl);
  }
  return createPgliteSql();
}

export function getSql(): Promise<Sql> {
  const policy = getDbPolicy();
  if (policy.mode === "unconfigured") {
    return Promise.reject(new DatabaseConfigurationError(policy.reason));
  }
  return createSql();
}

export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  const policy = getDbPolicy();
  if (policy.mode !== "local_fixture_pglite") {
    throw new DatabaseConfigurationError(
      policy.mode === "neon"
        ? "getPglite() is unavailable when DATABASE_URL is configured."
        : policy.reason,
    );
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

export function ensureDbReady(): Promise<void> {
  const policy = getDbPolicy();
  if (policy.mode !== "local_fixture_pglite") return Promise.resolve();
  return getSql().then(() => undefined);
}
