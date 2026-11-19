#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sceneGraphV1Schema } from "../src/lib/studio/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "shared");
mkdirSync(outDir, { recursive: true });
const jsonSchema = z.toJSONSchema(sceneGraphV1Schema, { unrepresentable: "any" });
writeFileSync(
  join(outDir, "scene-graph.schema.json"),
  JSON.stringify(jsonSchema, null, 2) + "\n",
  "utf8",
);
console.log("[build-schema] wrote shared/scene-graph.schema.json");
