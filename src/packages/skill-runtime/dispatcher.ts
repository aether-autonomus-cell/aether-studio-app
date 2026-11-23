import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { KrSkillTraceEntry } from "../contracts/schemas.ts";
import { evaluateSkillRegistry, resolveSkillsRoot } from "./registry.ts";

export const HookScoreInputSchema = z.object({
  hook: z.string().min(1).max(600),
});

export const TitleLintInputSchema = z.object({
  title: z.string().min(1).max(200),
  thumbnail_text: z.string().max(100).optional(),
});

export const DeadAirInputSchema = z.object({
  srt_content: z.string().min(1).max(60_000),
  floor_sec: z.number().min(0.1).max(5.0).default(0.45),
});

export const CinematicBeatsInputSchema = z.object({
  title: z.string().min(1).max(160),
  lines: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        spoken: z.string().min(1),
        hero: z.string().default("Narrator frame"),
        typed: z.string().default(""),
        gap_after: z.number().min(0).max(5).default(0.45),
      }),
    )
    .min(1)
    .max(60),
});

export type SkillToolName =
  | "youtube_score_hooks"
  | "youtube_lint_title"
  | "youtube_detect_deadair"
  | "cinematic_lint_beats"
  | "lemo_style_docs_lookup";

const TOOL_SPECS: Record<
  SkillToolName,
  {
    skill_id: string;
    schema: z.ZodTypeAny;
  }
> = {
  youtube_score_hooks: {
    skill_id: "youtube.agent",
    schema: HookScoreInputSchema,
  },
  youtube_lint_title: {
    skill_id: "youtube.agent",
    schema: TitleLintInputSchema,
  },
  youtube_detect_deadair: {
    skill_id: "youtube.agent",
    schema: DeadAirInputSchema,
  },
  cinematic_lint_beats: {
    skill_id: "cinematic.director",
    schema: CinematicBeatsInputSchema,
  },
  lemo_style_docs_lookup: {
    skill_id: "lemo.style_docs",
    schema: z.object({ query: z.string().min(1) }),
  },
};

export interface DispatchSkillResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string | null;
  trace: KrSkillTraceEntry;
}

function sanitizeSummary(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|key|password|auth/i.test(k)) {
      copy[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 240) {
      copy[k] = `${v.slice(0, 240)}…(${v.length} chars)`;
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

function runPythonJsonScript(scriptRelPath: string, args: string[]): { ok: boolean; parsed?: any; raw?: string; error?: string } {
  const root = resolveSkillsRoot();
  const abs = path.join(root, scriptRelPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, error: `Missing vendored skill asset: ${scriptRelPath}` };
  }
  const proc = spawnSync("python3", [abs, ...args], {
    encoding: "utf8",
    timeout: 8000,
  });
  if (proc.error) {
    const errCode = (proc.error as NodeJS.ErrnoException).code;
    if (errCode === "ENOENT") {
      return {
        ok: false,
        error:
          "Python runtime is unavailable in this serverless environment; run this skill via the paired Colab/local worker.",
      };
    }
    return { ok: false, error: "Skill script execution failed." };
  }
  if (proc.status !== 0) {
    return { ok: false, error: (proc.stderr || proc.stdout || `exit ${proc.status}`).trim() };
  }
  const raw = (proc.stdout || "").trim();
  try {
    return { ok: true, parsed: JSON.parse(raw), raw };
  } catch {
    return { ok: true, raw };
  }
}

export function dispatchSkillTool(
  toolName: SkillToolName,
  rawArgs: Record<string, unknown>,
): DispatchSkillResult {
  const started = Date.now();
  const traceId = `tr_${crypto.randomBytes(6).toString("hex")}`;
  const spec = TOOL_SPECS[toolName];

  const makeTrace = (
    status: KrSkillTraceEntry["status"],
    outputSummary: Record<string, unknown>,
  ): KrSkillTraceEntry => ({
    trace_id: traceId,
    skill_id: spec.skill_id,
    tool_name: toolName,
    status,
    duration_ms: Math.max(0, Date.now() - started),
    input_summary: sanitizeSummary(rawArgs),
    output_summary: sanitizeSummary(outputSummary),
    created_at: new Date().toISOString(),
  });

  // License & registry gate
  const registry = evaluateSkillRegistry({ verifyHashes: false });
  const skillRecord = registry.skills.find((s) => s.skill_id === spec.skill_id);
  if (!skillRecord) {
    return {
      ok: false,
      data: null,
      error: `Skill ${spec.skill_id} is not registered in skills.lock.json`,
      trace: makeTrace("unavailable", { reason: "unregistered" }),
    };
  }
  if (skillRecord.status === "blocked_licence") {
    return {
      ok: false,
      data: null,
      error: `Skill ${spec.skill_id} is blocked by commercial license gate (${skillRecord.spdx_license})`,
      trace: makeTrace("blocked_licence", { spdx_license: skillRecord.spdx_license }),
    };
  }
  if (skillRecord.status !== "ready") {
    return {
      ok: false,
      data: null,
      error: `Skill ${spec.skill_id} is ${skillRecord.status} and cannot execute here`,
      trace: makeTrace("unavailable", { status: skillRecord.status }),
    };
  }

  // Strict schema validation
  const parsedArgs = spec.schema.safeParse(rawArgs);
  if (!parsedArgs.success) {
    return {
      ok: false,
      data: null,
      error: `Invalid arguments for ${toolName}: ${parsedArgs.error.issues.map((i) => i.message).join("; ")}`,
      trace: makeTrace("rejected", { validation_errors: parsedArgs.error.issues.length }),
    };
  }

  const args = parsedArgs.data as Record<string, any>;

  if (toolName === "youtube_score_hooks") {
    const res = runPythonJsonScript(
      "skills/vendor/youtube-agent-skill/skills/yt-script/hookscore.py",
      ["--hook", String(args.hook), "--json"],
    );
    if (!res.ok) {
      return { ok: false, data: null, error: res.error ?? "hookscore failed", trace: makeTrace("unavailable", { error: res.error }) };
    }
    return {
      ok: true,
      data: res.parsed,
      error: null,
      trace: makeTrace("ok", { execution: "python_vendored", verdict: res.parsed?.verdict ?? null }),
    };
  }

  if (toolName === "youtube_lint_title") {
    const cli = ["--title", String(args.title), "--json"];
    if (args.thumbnail_text) cli.push("--thumb", String(args.thumbnail_text));
    const res = runPythonJsonScript(
      "skills/vendor/youtube-agent-skill/skills/yt-package/title.py",
      cli,
    );
    if (!res.ok) {
      return { ok: false, data: null, error: res.error ?? "title lint failed", trace: makeTrace("unavailable", { error: res.error }) };
    }
    return {
      ok: true,
      data: res.parsed,
      error: null,
      trace: makeTrace("ok", { execution: "python_vendored", issue_count: res.parsed?.issues?.length ?? 0 }),
    };
  }

  if (toolName === "youtube_detect_deadair") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kr-deadair-"));
    try {
      const srtPath = path.join(tmpDir, "captions.srt");
      fs.writeFileSync(srtPath, String(args.srt_content), "utf8");
      const res = runPythonJsonScript(
        "skills/vendor/youtube-agent-skill/skills/yt-edit/deadair.py",
        [srtPath, "--floor", String(args.floor_sec), "--json"],
      );
      if (!res.ok) {
        return { ok: false, data: null, error: res.error ?? "deadair failed", trace: makeTrace("unavailable", { error: res.error }) };
      }
      return {
        ok: true,
        data: res.parsed,
        error: null,
        trace: makeTrace("ok", { execution: "python_vendored", cuts: res.parsed?.cuts?.length ?? 0 }),
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (toolName === "cinematic_lint_beats") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kr-beats-"));
    try {
      const scriptDoc = {
        title: args.title,
        takes: [{ take: 1, lines: args.lines }],
      };
      fs.writeFileSync(path.join(tmpDir, "script.json"), JSON.stringify(scriptDoc, null, 2));
      const res = runPythonJsonScript(
        "skills/vendor/cinematic-skill/skills/cinematic-film/scripts/make_beats.py",
        ["--project", tmpDir],
      );
      if (!res.ok) {
        return { ok: false, data: null, error: res.error ?? "make_beats failed", trace: makeTrace("unavailable", { error: res.error }) };
      }
      const beatsMarkdown = fs.readFileSync(path.join(tmpDir, "beats.md"), "utf8");
      return {
        ok: true,
        data: { summary: res.raw ?? "", beats_markdown: beatsMarkdown },
        error: null,
        trace: makeTrace("ok", { execution: "python_vendored", lines: args.lines.length }),
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return {
    ok: false,
    data: null,
    error: `Unhandled tool ${toolName}`,
    trace: makeTrace("unavailable", { reason: "unhandled" }),
  };
}
