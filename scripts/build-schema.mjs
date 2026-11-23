#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { KrJobV1Schema, KrTimelineV1Schema } from "../src/packages/contracts/schemas.ts";

const ROOT = process.cwd();
const SHARED_DIR = path.join(ROOT, "shared");
fs.mkdirSync(SHARED_DIR, { recursive: true });

const jobJsonSchema = z.toJSONSchema(KrJobV1Schema, { target: "draft-2020-12" });
const timelineJsonSchema = z.toJSONSchema(KrTimelineV1Schema, { target: "draft-2020-12" });

fs.writeFileSync(
  path.join(SHARED_DIR, "kr.job.v1.schema.json"),
  JSON.stringify(jobJsonSchema, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(SHARED_DIR, "kr.timeline.v1.schema.json"),
  JSON.stringify(timelineJsonSchema, null, 2) + "\n",
);

console.log("[build-schema] Emitted shared/kr.job.v1.schema.json and shared/kr.timeline.v1.schema.json");
