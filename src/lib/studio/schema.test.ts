import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCHEMA_VERSION,
  canonicalJson,
  createDefaultProject,
  dimensionsForJob,
  sceneGraphV1Schema,
  sha256Hex,
} from "./schema.ts";

test("createDefaultProject passes canonical SceneGraphV1 Zod validation", () => {
  const project = createDefaultProject();
  const parsed = sceneGraphV1Schema.safeParse(project);
  assert.equal(parsed.success, true);
  assert.equal(project.schema_version, SCHEMA_VERSION);
  assert.deepEqual(project.project.languages, ["hi-IN", "en-US"]);
});

test("sceneGraphV1Schema enforces 120-scene ceiling and valid aspect ratios", () => {
  const base = createDefaultProject();
  const tooMany = {
    ...base,
    project: {
      ...base.project,
      scenes: Array.from({ length: 121 }, (_, i) => ({
        ...base.project.scenes[0],
        id: `s${i + 1}`,
      })),
    },
  };
  assert.equal(sceneGraphV1Schema.safeParse(tooMany).success, false);
  assert.deepEqual(dimensionsForJob("9:16", "1080p"), { width: 1080, height: 1920 });
  assert.deepEqual(dimensionsForJob("16:9", "540p"), { width: 960, height: 540 });
});

test("canonicalJson and sha256Hex produce key-order-independent digests", async () => {
  const a = { b: 2, a: { z: true, m: "hi" } };
  const b = { a: { m: "hi", z: true }, b: 2 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  const h1 = await sha256Hex(canonicalJson(a));
  const h2 = await sha256Hex(canonicalJson(b));
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test("shared/scene-graph.schema.json matches aether.2d.job@1", () => {
  const raw = JSON.parse(
    readFileSync(new URL("../../../shared/scene-graph.schema.json", import.meta.url), "utf8"),
  ) as { properties?: { schema_version?: { const?: string } } };
  assert.equal(raw.properties?.schema_version?.const, "aether.2d.job@1");
});
