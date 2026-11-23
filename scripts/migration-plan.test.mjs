import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";
import {
  checkMigrationPreconditions,
  downMigrationFileName,
  parseMigrateArgs,
} from "./migrate.mjs";
import { projectRoot } from "./with-app-env.mjs";

const AUTH_MIGRATION = "0001_auth.sql";

/**
 * The auth-on copy of the Better Auth schema and its source, or null when the
 * app has not turned sign-in on (the shipped state).
 */
function authSchemaCopy(root) {
  const copy = join(root, "migrations", AUTH_MIGRATION);
  const source = join(root, "migrations/auth", AUTH_MIGRATION);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // The auth-on path copies migrations/auth/0001_auth.sql into the globbed
  // directory; a database that already has it must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped (readdir also yields the auth/ directory)", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("the auth schema ships outside the globbed directory", () => {
  const migrationsDir = join(projectRoot(), "migrations");
  assert.equal(
    pendingMigrations(readdirSync(migrationsDir), []).some((m) => m.name === AUTH_MIGRATION),
    false,
  );
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes("0001_auth.sql"));
});

test("this workspace's auth schema copy is byte-identical to its source", () => {
  // An edited copy diverges silently: basename keying skips it on a database
  // that already ran the original, and applies it on a fresh PGLite preview.
  const pair = authSchemaCopy(projectRoot());
  if (pair === null) return; // sign-in off — nothing has been copied up
  assert.equal(
    pair.copy,
    pair.source,
    "migrations/0001_auth.sql has been edited — it must stay a verbatim copy of migrations/auth/0001_auth.sql",
  );
});

test("the copy check reads both files and catches an edit", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  writeFileSync(join(root, "migrations/auth", AUTH_MIGRATION), "create table t ();\n");
  assert.equal(authSchemaCopy(root), null);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t ();\n");
  const same = authSchemaCopy(root);
  assert.equal(same.copy, same.source);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t (x int);\n");
  const drifted = authSchemaCopy(root);
  assert.notEqual(drifted.copy, drifted.source);
});

test("npm run build does not invoke db:migrate automatically", () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot(), "package.json"), "utf8"));
  assert.equal(
    pkg.scripts.build.includes("db:migrate"),
    false,
    "build script must never auto-run db:migrate against shared/production DB",
  );
});

test("migrate.mjs blocks preview environments and missing DATABASE_URL", () => {
  const preview = checkMigrationPreconditions({
    env: { VERCEL_ENV: "preview", DATABASE_URL: "postgres://shared/prod" },
    mode: "apply",
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.code, "PREVIEW_MIGRATION_BLOCKED");

  const previewDown = checkMigrationPreconditions({
    env: { VERCEL_ENV: "preview", DATABASE_URL: "postgres://shared/prod" },
    mode: "down",
  });
  assert.equal(previewDown.ok, false);
  assert.equal(previewDown.code, "PREVIEW_MIGRATION_BLOCKED");

  const missingUrl = checkMigrationPreconditions({ env: {}, mode: "apply" });
  assert.equal(missingUrl.ok, false);
  assert.equal(missingUrl.code, "DATABASE_URL_MISSING");

  const ok = checkMigrationPreconditions({
    env: { VERCEL_ENV: "production", DATABASE_URL: "postgres://prod/db" },
    mode: "apply",
  });
  assert.equal(ok.ok, true);
});

test("migrate.mjs argument parser and down-migration mapping match reversible files", () => {
  assert.deepEqual(parseMigrateArgs(["--status"]), {
    mode: "status",
    target: null,
    includeAuth: false,
  });
  assert.deepEqual(parseMigrateArgs(["--status", "--include-auth"]), {
    mode: "status",
    target: null,
    includeAuth: true,
  });
  assert.deepEqual(parseMigrateArgs(["--down", "0002_katharift.sql"]), {
    mode: "down",
    target: "0002_katharift.sql",
    includeAuth: false,
  });
  assert.equal(downMigrationFileName("0002_katharift.sql"), "0002_katharift.down.sql");
  assert.equal(
    existsSync(join(projectRoot(), "migrations/down", downMigrationFileName("0002_katharift.sql"))),
    true,
  );
});

test("phone-friendly neon_bootstrap_v1_1.sql is idempotent and compatible with migrate.mjs", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const root = projectRoot();
  const bootstrapSql = readFileSync(join(root, "docs/sql/neon_bootstrap_v1_1.sql"), "utf8");
  const downSql = readFileSync(join(root, "migrations/down/0002_katharift.down.sql"), "utf8");

  const pg = new PGlite();
  await pg.waitReady;
  try {
    // Run once and verify idempotent re-run
    await pg.exec(bootstrapSql);
    await pg.exec(bootstrapSql);

    const migRows = await pg.query("SELECT name FROM _migrations ORDER BY name ASC");
    const applied = migRows.rows.map((r) => r.name);
    assert.deepEqual(applied, ["0001_auth.sql", "0002_katharift.sql"]);

    // Verify scripts/migrate.mjs sees 0 pending migrations afterwards
    assert.deepEqual(pendingMigrations(readdirSync(join(root, "migrations")), applied), []);

    // Verify both Better Auth tables and KathaRift tables exist
    const tableRows = await pg.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC",
    );
    const tables = tableRows.rows.map((r) => r.tablename);
    for (const required of [
      "user",
      "session",
      "account",
      "verification",
      "kr_projects",
      "kr_story_revisions",
      "kr_timeline_revisions",
      "kr_jobs",
    ]) {
      assert.ok(tables.includes(required), `missing table ${required}`);
    }

    // Verify reversible KathaRift rollback leaves Better Auth tables intact
    await pg.exec(downSql);
    const afterDown = (
      await pg.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    ).rows.map((r) => r.tablename);
    assert.equal(afterDown.includes("kr_projects"), false);
    assert.equal(afterDown.includes("user"), true);
    assert.equal(afterDown.includes("session"), true);
  } finally {
    await pg.close();
  }
});
