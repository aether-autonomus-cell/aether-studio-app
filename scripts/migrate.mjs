#!/usr/bin/env node
/**
 * Controlled PostgreSQL migrator (`node-postgres`, `pg`).
 *
 * IMPORTANT: Never invoked from `npm run build` so PR Preview builds cannot
 * mutate a shared or production database. Run explicitly as an operator step:
 *   DATABASE_URL=... npm run db:migrate:status
 *   DATABASE_URL=... npm run db:migrate
 *   DATABASE_URL=... npm run db:rollback -- 0002_katharift.sql
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";
import { isMainModule } from "./with-app-env.mjs";

export function parseMigrateArgs(argv) {
  if (argv.includes("--status")) return { mode: "status", target: null };
  const downIdx = argv.indexOf("--down");
  if (downIdx !== -1) {
    const target = argv[downIdx + 1]?.trim();
    if (!target) {
      return {
        mode: "error",
        error: "usage: node scripts/migrate.mjs --down <migration.sql>",
      };
    }
    return { mode: "down", target };
  }
  return { mode: "apply", target: null };
}

export function checkMigrationPreconditions({ env = process.env, mode = "apply" } = {}) {
  if (mode !== "status" && env.VERCEL_ENV?.trim() === "preview") {
    return {
      ok: false,
      code: "PREVIEW_MIGRATION_BLOCKED",
      error:
        "[migrate] refused: VERCEL_ENV=preview must never mutate a shared or production database.",
    };
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      ok: false,
      code: "DATABASE_URL_MISSING",
      error:
        "[migrate] DATABASE_URL is required for controlled migrations (no silent skip).",
    };
  }
  return { ok: true, databaseUrl };
}

export function downMigrationFileName(upFileName) {
  const base = upFileName.split("/").pop() ?? upFileName;
  if (!base.endsWith(".sql")) {
    throw new Error(`Expected .sql migration filename, got: ${upFileName}`);
  }
  return `${base.slice(0, -4)}.down.sql`;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main(argv) {
  const parsed = parseMigrateArgs(argv);
  if (parsed.mode === "error") {
    console.error(parsed.error);
    process.exit(2);
  }

  const pre = checkMigrationPreconditions({ env: process.env, mode: parsed.mode });
  if (!pre.ok) {
    console.error(pre.error);
    process.exit(1);
  }

  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: pre.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations ORDER BY name ASC")).rows.map(
      (r) => r.name,
    );
    const pending = pendingMigrations(entries, applied);

    if (parsed.mode === "status") {
      console.log(
        JSON.stringify(
          {
            applied,
            pending: pending.map((p) => p.name),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (parsed.mode === "down") {
      const target = parsed.target;
      if (!applied.includes(target)) {
        console.log(`[migrate] ${target} is not currently recorded in _migrations — nothing to roll back.`);
        return;
      }
      const downName = downMigrationFileName(target);
      const downPath = join(migrationsDir, "down", downName);
      const downSql = await readFile(downPath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(downSql);
        await client.query("DELETE FROM _migrations WHERE name = $1", [target]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
      console.log(`[migrate] rolled back ${target} via migrations/down/${downName}`);
      return;
    }

    if (pending.length === 0) {
      console.log("[migrate] up to date.");
      return;
    }

    let count = 0;
    for (const { name } of pending) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // keep original error
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(`[migrate] done — ${count} migration(s) applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[migrate] failed:", err?.message || err);
    for (const key of ["code", "detail", "hint", "position", "where"]) {
      if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
    }
    process.exit(1);
  });
}
