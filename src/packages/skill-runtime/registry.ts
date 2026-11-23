import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class SkillRegistryUnavailableError extends Error {
  readonly status = 500;
  readonly code = "SKILLS_REGISTRY_UNAVAILABLE";

  constructor(
    message = "Skill registry is unavailable on the server. Provisioned skills assets are missing or unreadable.",
  ) {
    super(message);
    this.name = "SkillRegistryUnavailableError";
  }
}

export type SkillStatus =
  | "ready"
  | "waiting_worker"
  | "blocked_licence"
  | "unavailable_incompatible"
  | "dev_only_not_production"
  | "broken";

export interface LockedFileEntry {
  path: string;
  upstream_path: string;
  sha256: string;
  bytes: number;
}

export interface LockedSkillEntry {
  skill_id: string;
  name: string;
  kind: string;
  source_repo: string;
  source_commit: string;
  tarball_sha256: string | null;
  spdx_license: string;
  licence_state: string;
  runtime: string;
  profiles: string[];
  adapter: string | null;
  tools: string[];
  instruction_files: LockedFileEntry[];
  entrypoint_files: LockedFileEntry[];
  prerequisites: string[];
  initial_status: SkillStatus;
  notes: string;
}

export interface SkillsLockDocument {
  schema_version: "kr.skills.lock.v1";
  generated_at: string;
  skills: LockedSkillEntry[];
}

export interface SkillRuntimeRecord {
  skill_id: string;
  name: string;
  kind: string;
  runtime: string;
  profiles: string[];
  spdx_license: string;
  licence_state: string;
  source_repo: string;
  source_commit: string;
  adapter: string | null;
  tools: string[];
  status: SkillStatus;
  files_verified: boolean;
  execution_ready: boolean;
  execution_note: string;
  verified_files: number;
  total_files: number;
  missing_files: string[];
  hash_mismatches: Array<{ path: string; expected: string; actual: string }>;
  notes: string;
}

export interface SkillRegistryReport {
  schema_version: "kr.skills.status.v1";
  checked_at: string;
  worker_active: boolean;
  python_available: boolean;
  summary: {
    total: number;
    ready: number;
    provisioned_files_ready: number;
    execution_ready: number;
    waiting_worker: number;
    blocked_licence: number;
    unavailable_incompatible: number;
    dev_only_not_production: number;
    broken: number;
  };
  skills: SkillRuntimeRecord[];
}

let cachedPythonAvailable: boolean | null = null;

export function hasPythonRuntime(): boolean {
  if (cachedPythonAvailable !== null) return cachedPythonAvailable;
  try {
    const res = spawnSync("python3", ["--version"], {
      encoding: "utf8",
      timeout: 2000,
    });
    cachedPythonAvailable = !res.error && res.status === 0;
  } catch {
    cachedPythonAvailable = false;
  }
  return cachedPythonAvailable;
}

let cachedLock: { root: string; doc: SkillsLockDocument } | null = null;

function isValidSkillsRoot(dir: string): boolean {
  try {
    return (
      fs.existsSync(path.join(dir, "skills.lock.json")) &&
      fs.existsSync(path.join(dir, "skills", "manifests"))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the directory containing the provisioned `skills.lock.json`,
 * `skills/manifests/`, and `skills/vendor/`. Fails closed with
 * `SkillRegistryUnavailableError` (without exposing internal server paths or
 * falling back to mock/empty data) if the registry bundle is absent.
 */
export function resolveSkillsRoot(): string {
  const override = process.env.KR_SKILLS_ROOT?.trim();
  if (override) {
    if (isValidSkillsRoot(override)) {
      return override;
    }
    throw new SkillRegistryUnavailableError();
  }

  const candidates: string[] = [];
  const pushCandidate = (dir: string | undefined) => {
    const trimmed = dir?.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  pushCandidate(process.cwd());
  pushCandidate(process.env.LAMBDA_TASK_ROOT);

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i += 1) {
      pushCandidate(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore if import.meta.url is unavailable */
  }

  pushCandidate("/var/task");

  for (const candidate of candidates) {
    if (isValidSkillsRoot(candidate)) {
      return candidate;
    }
  }

  throw new SkillRegistryUnavailableError();
}

export function loadSkillsLock(): SkillsLockDocument {
  const root = resolveSkillsRoot();
  if (cachedLock && cachedLock.root === root) return cachedLock.doc;
  const lockPath = path.join(root, "skills.lock.json");
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as SkillsLockDocument;
    if (!parsed || !Array.isArray(parsed.skills)) {
      throw new SkillRegistryUnavailableError();
    }
    cachedLock = { root, doc: parsed };
    return parsed;
  } catch (err) {
    if (err instanceof SkillRegistryUnavailableError) throw err;
    throw new SkillRegistryUnavailableError();
  }
}

function sha256File(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function evaluateSkillRegistry(opts?: {
  verifyHashes?: boolean;
  workerActive?: boolean;
  pythonAvailable?: boolean;
}): SkillRegistryReport {
  const verifyHashes = opts?.verifyHashes ?? true;
  const workerActive = opts?.workerActive ?? process.env.KR_WORKER_ACTIVE === "1";
  const pythonAvailable = opts?.pythonAvailable ?? hasPythonRuntime();
  const root = resolveSkillsRoot();
  const lock = loadSkillsLock();

  const records: SkillRuntimeRecord[] = lock.skills.map((skill) => {
    // Hard license gate: CC-BY-NC-4.0 or any non-approved license is NEVER executable or loadable.
    if (skill.licence_state !== "approved" || skill.spdx_license.includes("NC")) {
      return {
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
        files_verified: false,
        execution_ready: false,
        execution_note: `Blocked by commercial license gate (${skill.spdx_license}).`,
        verified_files: 0,
        total_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      };
    }

    if (skill.initial_status === "unavailable_incompatible") {
      return {
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
        files_verified: false,
        execution_ready: false,
        execution_note: skill.notes,
        verified_files: 0,
        total_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      };
    }

    if (skill.initial_status === "dev_only_not_production") {
      return {
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
        files_verified: false,
        execution_ready: false,
        execution_note: skill.notes,
        verified_files: 0,
        total_files: 0,
        missing_files: [],
        hash_mismatches: [],
        notes: skill.notes,
      };
    }

    const allFiles = [...skill.instruction_files, ...skill.entrypoint_files];
    const missingFiles: string[] = [];
    const hashMismatches: Array<{ path: string; expected: string; actual: string }> = [];
    let verified = 0;

    const manifestRel = path.posix.join("skills", "manifests", `${skill.skill_id}.json`);
    if (!fs.existsSync(path.join(root, manifestRel))) {
      missingFiles.push(manifestRel);
    }

    for (const file of allFiles) {
      const abs = path.join(root, file.path);
      if (!fs.existsSync(abs)) {
        missingFiles.push(file.path);
        continue;
      }
      if (verifyHashes) {
        const actual = sha256File(abs);
        if (actual !== file.sha256) {
          hashMismatches.push({ path: file.path, expected: file.sha256, actual });
          continue;
        }
      }
      verified += 1;
    }

    const filesVerified = missingFiles.length === 0 && hashMismatches.length === 0;
    const needsPython = skill.entrypoint_files.some((f) => f.path.endsWith(".py"));

    let status: SkillStatus = skill.initial_status;
    let executionReady = false;
    let executionNote = skill.notes;

    if (!filesVerified) {
      status = "broken";
      executionReady = false;
      executionNote = "Provisioned skill manifest or asset files are missing or mismatched.";
    } else if (skill.runtime.startsWith("worker.")) {
      status = workerActive ? "ready" : "waiting_worker";
      executionReady = workerActive;
      executionNote = workerActive
        ? "Provisioned worker files verified and paired worker session is active."
        : "Provisioned files verified on disk; execution requires a paired Colab/local worker.";
    } else if (skill.runtime === "app.server") {
      if (needsPython && !pythonAvailable) {
        status = "waiting_worker";
        executionReady = false;
        executionNote =
          "Provisioned Python scripts verified on disk, but Python3 runtime is unavailable in this serverless Node environment; execution requires a paired Colab/local Python worker.";
      } else {
        status = "ready";
        executionReady = true;
        executionNote = needsPython
          ? "Provisioned files verified and Python3 runtime active on server."
          : "Provisioned files verified and runnable on server.";
      }
    }

    return {
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
      files_verified: filesVerified,
      execution_ready: executionReady,
      execution_note: executionNote,
      verified_files: verified,
      total_files: allFiles.length,
      missing_files: missingFiles,
      hash_mismatches: hashMismatches,
      notes: skill.notes,
    };
  });

  return {
    schema_version: "kr.skills.status.v1",
    checked_at: new Date().toISOString(),
    worker_active: workerActive,
    python_available: pythonAvailable,
    summary: {
      total: records.length,
      ready: records.filter((r) => r.status === "ready").length,
      provisioned_files_ready: records.filter((r) => r.files_verified).length,
      execution_ready: records.filter((r) => r.execution_ready).length,
      waiting_worker: records.filter((r) => r.status === "waiting_worker").length,
      blocked_licence: records.filter((r) => r.status === "blocked_licence").length,
      unavailable_incompatible: records.filter((r) => r.status === "unavailable_incompatible").length,
      dev_only_not_production: records.filter((r) => r.status === "dev_only_not_production").length,
      broken: records.filter((r) => r.status === "broken").length,
    },
    skills: records,
  };
}
