import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseConfigurationError, resolveDbPolicy } from "../../lib/db-policy.ts";
import { getSql } from "../../lib/db.ts";
import { authenticateApiRequest } from "./auth-guard.ts";
import { AuthConfigurationError, resolveServerAuthPolicy } from "./auth-policy.ts";
import {
  confirmAndEnqueueProductionJob,
  createOrRenderExport,
  createStoryPatchProposal,
  createWorkerPairingSession,
  getOrCreateActiveWorkspace,
  loadWorkspaceState,
  postWorkerCheckpoint,
  resolveStoryPatch,
  saveSettingsRevision,
  saveTimelineEditRevision,
} from "./repository.ts";
import { ProjectNotFoundError } from "./route-errors.ts";

describe("Database Configuration Policy (No Silent Ephemeral PGLite)", () => {
  it("fails closed in preview and production when DATABASE_URL is missing, even with KR_LOCAL_FIXTURE_DB=true", () => {
    for (const env of [
      { VERCEL: "1", VERCEL_ENV: "preview" },
      { VERCEL: "1", VERCEL_ENV: "production", KR_LOCAL_FIXTURE_DB: "true" },
      { NODE_ENV: "production", KR_LOCAL_FIXTURE_DB: "true" },
      { GROK_PROJECT_ID: "proj_123", KR_LOCAL_FIXTURE_DB: "true" },
      { CI: "true", KR_LOCAL_FIXTURE_DB: "true" },
    ]) {
      const policy = resolveDbPolicy(env);
      assert.equal(policy.mode, "unconfigured");
      assert.equal(policy.dbSource, null);
      assert.equal(policy.isEphemeralFixture, false);
    }
  });

  it("fails closed locally when DATABASE_URL is missing and KR_LOCAL_FIXTURE_DB is not set", async () => {
    const prevDb = process.env.DATABASE_URL;
    const prevFixture = process.env.KR_LOCAL_FIXTURE_DB;
    const prevNodeEnv = process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.KR_LOCAL_FIXTURE_DB;
    delete process.env.NODE_ENV;
    try {
      const policy = resolveDbPolicy({});
      assert.equal(policy.mode, "unconfigured");
      await assert.rejects(() => getSql(), DatabaseConfigurationError);
    } finally {
      if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
      if (prevFixture !== undefined) process.env.KR_LOCAL_FIXTURE_DB = prevFixture;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it("only enables ephemeral PGLite in explicitly labelled local fixture mode", () => {
    const policy = resolveDbPolicy({ KR_LOCAL_FIXTURE_DB: "true" });
    assert.equal(policy.mode, "local_fixture_pglite");
    assert.equal(policy.dbSource, "pglite");
    assert.equal(policy.isEphemeralFixture, true);
    assert.equal(policy.label, "LOCAL_FIXTURE_EPHEMERAL_PGLITE");
  });

  it("uses durable Postgres when DATABASE_URL is provided", () => {
    const policy = resolveDbPolicy({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: "postgres://user:pass@ep-demo.neon.tech/db",
    });
    assert.equal(policy.mode, "neon");
    assert.equal(policy.dbSource, "neon");
    assert.equal(policy.isEphemeralFixture, false);
  });
});

describe("Fail-Closed Server Auth Policy (Immune to VITE_* Flags)", () => {
  it("rejects when server auth secrets are missing even if VITE_AUTH_ENABLED=false", async () => {
    const req = new Request("http://127.0.0.1:8080/api/kr/workspace");
    const res = await authenticateApiRequest(req, {
      deps: {
        env: { VITE_AUTH_ENABLED: "false", KR_LOCAL_FIXTURE_DB: "true" },
      },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.response.status, 401);
      const body = (await res.response.json()) as { code?: string };
      assert.equal(body.code, "AUTH_NOT_CONFIGURED");
    }
  });

  it("rejects unauthenticated requests when secrets are configured even if VITE_AUTH_ENABLED=false", async () => {
    const req = new Request("http://127.0.0.1:8080/api/kr/workspace");
    const res = await authenticateApiRequest(req, {
      deps: {
        env: {
          VITE_AUTH_ENABLED: "false",
          BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
          GROK_AUTH_CLIENT_ID: "client_123",
          GROK_AUTH_CLIENT_SECRET: "secret_456",
        },
        resolveUserId: async () => {
          throw new Error("Unauthorized");
        },
      },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.response.status, 401);
    }
  });

  it("requires explicit OAuth or GROK_PROJECT_ID in preview/production", () => {
    const missingSecret = resolveServerAuthPolicy({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VITE_AUTH_ENABLED: "false",
    });
    assert.equal(missingSecret.configured, false);

    const shortSecret = resolveServerAuthPolicy({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      BETTER_AUTH_SECRET: "short",
      GROK_AUTH_CLIENT_ID: "id",
      GROK_AUTH_CLIENT_SECRET: "sec",
    });
    assert.equal(shortSecret.configured, false);

    const configured = resolveServerAuthPolicy({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VITE_AUTH_ENABLED: "false",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      GROK_AUTH_CLIENT_ID: "id",
      GROK_AUTH_CLIENT_SECRET: "sec",
    });
    assert.equal(configured.configured, true);
  });

  it("rejects cross-site state mutations with 403", async () => {
    const req = new Request("http://127.0.0.1:8080/api/kr/settings", { method: "POST" });
    const res = await authenticateApiRequest(req, {
      checkSameOrigin: true,
      deps: {
        env: {
          BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
          GROK_AUTH_CLIENT_ID: "id",
          GROK_AUTH_CLIENT_SECRET: "sec",
        },
        assertSameSite: () => {
          throw new Error("Cross-site blocked");
        },
      },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.response.status, 403);
    }
  });
});

describe("Wrong-Owner Isolation & Worker Lease/Session Fencing", () => {
  it("isolates projects, patches, settings, jobs, pairing, timelines, and exports per user", async () => {
    const prevDb = process.env.DATABASE_URL;
    const prevFixture = process.env.KR_LOCAL_FIXTURE_DB;
    const prevVercel = process.env.VERCEL;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCi = process.env.CI;
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.NODE_ENV;
    delete process.env.CI;
    process.env.KR_LOCAL_FIXTURE_DB = "true";

    try {
      const ownerA = "user_owner_a";
      const attackerB = "user_attacker_b";

      const wsA = await getOrCreateActiveWorkspace(ownerA);
      assert.equal(wsA.runtime.db_mode, "local_fixture_pglite");
      assert.equal(wsA.runtime.is_ephemeral_fixture, true);
      assert.equal(wsA.runtime.label, "LOCAL_FIXTURE_EPHEMERAL_PGLITE");

      const projA = wsA.project.project_id;
      const proposed = await createStoryPatchProposal(ownerA, projA, "Increase cliffhanger tension in scene 1");

      // Attacker B cannot read or mutate Owner A's project
      await assert.rejects(() => loadWorkspaceState(attackerB, projA), ProjectNotFoundError);
      await assert.rejects(
        () => createStoryPatchProposal(attackerB, projA, "Hijack story"),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () =>
          resolveStoryPatch({
            userId: attackerB,
            projectId: projA,
            patchId: proposed.patch.patch_id,
            action: "accept",
          }),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () => saveSettingsRevision(attackerB, projA, { director_route: "google-gemini-free-tier" }),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () =>
          confirmAndEnqueueProductionJob({
            userId: attackerB,
            projectId: projA,
            idempotencyKey: "attacker-key-1234",
            confirmedByUser: true,
          }),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () => createWorkerPairingSession(attackerB, projA),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () =>
          saveTimelineEditRevision({
            userId: attackerB,
            projectId: projA,
            expectedVersion: wsA.timeline.version,
            actionLabel: "Hijack timeline",
            timeline: wsA.timeline,
          }),
        ProjectNotFoundError,
      );
      await assert.rejects(
        () => createOrRenderExport({ userId: attackerB, projectId: projA, format: "srt_hi" }),
        ProjectNotFoundError,
      );

      // Owner A can still access and pair worker; wrong worker_session_id is rejected
      await confirmAndEnqueueProductionJob({
        userId: ownerA,
        projectId: projA,
        idempotencyKey: "owner-a-job-1234",
        confirmedByUser: true,
      });
      const pair = await createWorkerPairingSession(ownerA, projA, "local_python_worker");
      const { claimJobForWorker } = await import("./repository.ts");
      const claimed = await claimJobForWorker({ pairingCode: pair.pairing_code });
      assert.ok(claimed.job && claimed.lease_token);

      await assert.rejects(
        () =>
          postWorkerCheckpoint({
            jobId: claimed.job!.job_id,
            workerSessionId: "ws_wrong_session",
            leaseToken: claimed.lease_token!,
            seq: 1,
            sceneId: claimed.job!.scenes[0].scene_id,
            stage: "image",
            checkpointPatch: { status: "running" },
            message: "spoofed session",
          }),
        /worker_session_id/,
      );
    } finally {
      if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
      else delete process.env.DATABASE_URL;
      if (prevFixture !== undefined) process.env.KR_LOCAL_FIXTURE_DB = prevFixture;
      else delete process.env.KR_LOCAL_FIXTURE_DB;
      if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
      else delete process.env.VERCEL;
      if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv;
      else delete process.env.VERCEL_ENV;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      if (prevCi !== undefined) process.env.CI = prevCi;
      else delete process.env.CI;
    }
  });
});

// Keep AuthConfigurationError referenced for export contract
assert.equal(typeof AuthConfigurationError, "function");
