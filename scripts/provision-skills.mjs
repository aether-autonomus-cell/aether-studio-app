#!/usr/bin/env node
/**
 * KathaRift Studio — Automatic Skill Provisioner & Lock Verifier (Section 33)
 *
 * Usage:
 *   node scripts/provision-skills.mjs --profile app
 *   node scripts/provision-skills.mjs --profile worker
 *   node scripts/provision-skills.mjs --profile all [--verify-only]
 *
 * Zero-Spend & License Gate guarantees:
 * - Only verifies/provisions pinned commits listed in skills.lock.json.
 * - Strictly refuses CC-BY-NC-4.0 or blocked_non_commercial entries from active packs.
 * - Never marks worker-only or incompatible skills as "ready" on the app host without prerequisites.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const LOCK_PATH = path.join(ROOT, "skills.lock.json");
const MANIFESTS_DIR = path.join(ROOT, "skills", "manifests");
const STATUS_PATH = path.join(ROOT, "skills", "registry-status.json");

function parseArgs(argv) {
  let profile = "all";
  let verifyOnly = false;
  let strict = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile" && argv[i + 1]) {
      profile = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
    } else if (arg === "--verify-only") {
      verifyOnly = true;
    } else if (arg === "--strict") {
      strict = true;
    }
  }
  if (!["app", "worker", "all"].includes(profile)) {
    throw new Error(`Invalid --profile "${profile}". Expected app | worker | all.`);
  }
  return { profile, verifyOnly, strict };
}

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function checkCmd(cmd, args) {
  try {
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
    return { ok: res.status === 0, stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim() };
  } catch {
    return { ok: false, stdout: "", stderr: "spawn_error" };
  }
}

function detectEnvironmentCapabilities() {
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  const pythonCheck = checkCmd("python3", ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"]);
  const numpyScipyCheck = checkCmd("python3", ["-c", "import numpy, scipy; print('ok')"]);
  const ffmpegCheck = checkCmd("ffmpeg", ["-version"]);
  return {
    nodeVersion: process.versions.node,
    nodeMajor,
    pythonVersion: pythonCheck.ok ? pythonCheck.stdout : null,
    hasNumpyScipy: numpyScipyCheck.ok,
    hasFfmpeg: ffmpegCheck.ok,
    hasActivePermittedWorker: Boolean(process.env.KR_WORKER_ACTIVE === "1"),
  };
}

function main() {
  const { profile, verifyOnly, strict } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(LOCK_PATH)) {
    throw new Error(`Missing ${LOCK_PATH}`);
  }
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  const env = detectEnvironmentCapabilities();

  fs.mkdirSync(MANIFESTS_DIR, { recursive: true });

  const results = [];
  let brokenCount = 0;

  for (const skill of lock.skills) {
    // Write deterministic per-skill manifest (unless verifyOnly)
    const manifestPath = path.join(MANIFESTS_DIR, `${skill.skill_id}.json`);
    const manifestDoc = {
      schema_version: "kr.skill.manifest.v1",
      skill_id: skill.skill_id,
      name: skill.name,
      kind: skill.kind,
      source_repo: skill.source_repo,
      source_commit: skill.source_commit,
      spdx_license: skill.spdx_license,
      licence_state: skill.licence_state,
      runtime: skill.runtime,
      profiles: skill.profiles,
      adapter: skill.adapter,
      tools: skill.tools,
      instruction_files: skill.instruction_files.map((f) => f.path),
      entrypoint_files: skill.entrypoint_files.map((f) => f.path),
      prerequisites: skill.prerequisites,
      notes: skill.notes,
    };
    if (!verifyOnly) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifestDoc, null, 2) + "\n");
    }

    // Enforce license gate first
    if (skill.licence_state !== "approved" || skill.spdx_license.includes("NC")) {
      results.push({
        skill_id: skill.skill_id,
        name: skill.name,
        kind: skill.kind,
        runtime: skill.runtime,
        profiles: skill.profiles,
        spdx_license: skill.spdx_license,
        licence_state: skill.licence_state,
        source_repo: skill.source_repo,
        source_commit: skill.source_commit,
        adapter: skill.adapter,
        tools: [],
        status: "blocked_licence",
        verified_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      });
      continue;
    }

    if (skill.initial_status === "unavailable_incompatible") {
      results.push({
        skill_id: skill.skill_id,
        name: skill.name,
        kind: skill.kind,
        runtime: skill.runtime,
        profiles: skill.profiles,
        spdx_license: skill.spdx_license,
        licence_state: skill.licence_state,
        source_repo: skill.source_repo,
        source_commit: skill.source_commit,
        adapter: skill.adapter,
        tools: [],
        status: "unavailable_incompatible",
        verified_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      });
      continue;
    }

    if (skill.initial_status === "dev_only_not_production") {
      results.push({
        skill_id: skill.skill_id,
        name: skill.name,
        kind: skill.kind,
        runtime: skill.runtime,
        profiles: skill.profiles,
        spdx_license: skill.spdx_license,
        licence_state: skill.licence_state,
        source_repo: skill.source_repo,
        source_commit: skill.source_commit,
        adapter: skill.adapter,
        tools: [],
        status: "dev_only_not_production",
        verified_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      });
      continue;
    }

    // Verify all vendored instruction & entrypoint files against SHA-256 lock
    const allFiles = [...skill.instruction_files, ...skill.entrypoint_files];
    const missingFiles = [];
    const hashMismatches = [];
    let verifiedFiles = 0;

    for (const f of allFiles) {
      const abs = path.join(ROOT, f.path);
      if (!fs.existsSync(abs)) {
        missingFiles.push(f.path);
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== f.sha256) {
        hashMismatches.push({ path: f.path, expected: f.sha256, actual });
        continue;
      }
      verifiedFiles += 1;
    }

    let status = skill.initial_status;
    if (missingFiles.length > 0 || hashMismatches.length > 0) {
      status = "broken";
      brokenCount += 1;
    } else if (skill.runtime.startsWith("worker.")) {
      // Worker tools are provisioned locally (verified SHA-256), but execution readiness depends on worker/prereqs
      const prereqOk =
        (!skill.prerequisites.includes("node>=22") || env.nodeMajor >= 22) &&
        (!skill.prerequisites.includes("numpy") || env.hasNumpyScipy) &&
        (!skill.prerequisites.includes("ffmpeg") || env.hasFfmpeg) &&
        (!skill.prerequisites.includes("active_permitted_worker") || env.hasActivePermittedWorker);

      if (profile === "worker" && prereqOk) {
        status = "ready";
      } else {
        status = "waiting_worker";
      }
    } else if (skill.runtime === "app.server") {
      status = "ready";
    }

    results.push({
      skill_id: skill.skill_id,
      name: skill.name,
      kind: skill.kind,
      runtime: skill.runtime,
      profiles: skill.profiles,
      spdx_license: skill.spdx_license,
      licence_state: skill.licence_state,
      source_repo: skill.source_repo,
      source_commit: skill.source_commit,
      adapter: skill.adapter,
      tools: skill.tools,
      status,
      verified_files: verifiedFiles,
      total_files: allFiles.length,
      missing_files: missingFiles,
      hash_mismatches: hashMismatches,
      notes: skill.notes,
    });
  }

  const report = {
    schema_version: "kr.skills.status.v1",
    profile,
    checked_at: new Date().toISOString(),
    environment: env,
    summary: {
      total: results.length,
      ready: results.filter((r) => r.status === "ready").length,
      waiting_worker: results.filter((r) => r.status === "waiting_worker").length,
      blocked_licence: results.filter((r) => r.status === "blocked_licence").length,
      unavailable_incompatible: results.filter((r) => r.status === "unavailable_incompatible").length,
      dev_only_not_production: results.filter((r) => r.status === "dev_only_not_production").length,
      broken: brokenCount,
    },
    skills: results,
  };

  if (!verifyOnly) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(report, null, 2) + "\n");
  }

  console.log(
    `[provision-skills] profile=${profile} total=${report.summary.total} ready=${report.summary.ready} waiting_worker=${report.summary.waiting_worker} blocked_licence=${report.summary.blocked_licence} unavailable=${report.summary.unavailable_incompatible} dev_only=${report.summary.dev_only_not_production} broken=${brokenCount}`
  );

  if (brokenCount > 0 || (strict && brokenCount > 0)) {
    console.error("[provision-skills] Integrity failure:", JSON.stringify(results.filter((r) => r.status === "broken"), null, 2));
    process.exit(1);
  }
}

main();
