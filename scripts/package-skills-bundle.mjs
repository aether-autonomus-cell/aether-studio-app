import fs from "node:fs";
import path from "node:path";

/**
 * Package the provisioned Section 33 skill registry (`skills.lock.json`,
 * `skills/manifests`, `skills/registry-status.json`, and `skills/vendor`) into
 * the Nitro server output directory (`.vercel/output/functions/__server.func`)
 * so deployed serverless functions have all verified lock, manifest,
 * instruction, and vendored runtime assets on disk without runtime git
 * downloads or mock fallbacks.
 *
 * @param {string} rootDir
 * @param {string} serverDir
 */
export function packageSkillsIntoServerDir(rootDir, serverDir) {
  if (!serverDir) {
    throw new Error("packageSkillsIntoServerDir requires a target serverDir");
  }
  const lockSrc = path.join(rootDir, "skills.lock.json");
  const manifestsSrc = path.join(rootDir, "skills", "manifests");
  const vendorSrc = path.join(rootDir, "skills", "vendor");
  const statusSrc = path.join(rootDir, "skills", "registry-status.json");

  if (!fs.existsSync(lockSrc)) {
    throw new Error("Cannot package server bundle: skills.lock.json is missing.");
  }
  const lock = JSON.parse(fs.readFileSync(lockSrc, "utf8"));
  if (!fs.existsSync(manifestsSrc)) {
    throw new Error("Cannot package server bundle: skills/manifests directory is missing.");
  }
  if (!fs.existsSync(vendorSrc)) {
    throw new Error("Cannot package server bundle: skills/vendor directory is missing.");
  }

  for (const skill of lock.skills ?? []) {
    if (
      skill.licence_state !== "approved" ||
      String(skill.spdx_license || "").includes("NC") ||
      skill.initial_status === "unavailable_incompatible" ||
      skill.initial_status === "dev_only_not_production"
    ) {
      continue;
    }
    const manifestFile = path.join(manifestsSrc, `${skill.skill_id}.json`);
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`Cannot package server bundle: missing manifest for ${skill.skill_id}`);
    }
    for (const file of [...(skill.instruction_files ?? []), ...(skill.entrypoint_files ?? [])]) {
      const abs = path.join(rootDir, file.path);
      if (!fs.existsSync(abs)) {
        throw new Error(`Cannot package server bundle: missing locked file ${file.path}`);
      }
    }
  }

  fs.mkdirSync(serverDir, { recursive: true });
  fs.copyFileSync(lockSrc, path.join(serverDir, "skills.lock.json"));

  const skillsDest = path.join(serverDir, "skills");
  fs.mkdirSync(skillsDest, { recursive: true });
  fs.cpSync(manifestsSrc, path.join(skillsDest, "manifests"), { recursive: true });
  fs.cpSync(vendorSrc, path.join(skillsDest, "vendor"), { recursive: true });
  if (fs.existsSync(statusSrc)) {
    fs.copyFileSync(statusSrc, path.join(skillsDest, "registry-status.json"));
  }
}
