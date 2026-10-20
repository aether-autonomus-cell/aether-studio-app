export type JobPhase = "queued" | "running" | "done" | "error" | "unknown";

export type JobSnapshot = {
  id: string;
  status: JobPhase;
  progress: number;
  label: string;
  error: string;
  mp4Url: string | null;
};

const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function assertJobId(id: string): string {
  const clean = id.trim();
  if (!ID_RE.test(clean)) throw new Error("That job id is not valid.");
  return clean;
}

export function jobResourcePath(id: string, leaf?: "mp4"): string {
  const safe = assertJobId(id);
  return leaf ? `/api/v1/jobs/${safe}/mp4` : `/api/v1/jobs/${safe}`;
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const clean = String(Math.trunc(value));
    return ID_RE.test(clean) ? clean : null;
  }
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return ID_RE.test(clean) ? clean : null;
}

export function readJobId(body: string): string | null {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const nested = json.job && typeof json.job === "object" ? (json.job as Record<string, unknown>) : null;
    return asId(json.id) ?? asId(json.job_id) ?? asId(json.jobId) ?? (nested ? asId(nested.id) ?? asId(nested.job_id) : null);
  } catch {
    return null;
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function phaseOf(raw: string): JobPhase {
  const status = raw.toLowerCase();
  if (/queue|pending|accept|submit|wait/.test(status)) return "queued";
  if (/run|process|work|progress|start|paint|render|encod/.test(status)) return "running";
  if (/done|complete|success|ready|finish/.test(status)) return "done";
  if (/error|fail|cancel/.test(status)) return "error";
  return "unknown";
}

function progressOf(row: Record<string, unknown>): { progress: number; label: string } {
  const progress = row.progress;
  if (typeof progress === "number") return { progress: clampProgress(progress), label: "" };
  if (typeof progress === "string") {
    const n = Number(progress.replace("%", "").trim());
    if (!Number.isNaN(n)) return { progress: clampProgress(n), label: "" };
  }
  if (progress && typeof progress === "object") {
    const box = progress as Record<string, unknown>;
    const current = Number(box.current ?? box.done ?? box.completed ?? 0);
    const total = Number(box.total ?? 0);
    const label = typeof box.label === "string" ? box.label : typeof box.step === "string" ? box.step : "";
    if (total > 0 && Number.isFinite(current)) return { progress: clampProgress(current / total), label };
    if (typeof box.percent === "number") return { progress: clampProgress(box.percent), label };
  }
  if (typeof row.percent === "number") return { progress: clampProgress(row.percent), label: "" };
  return { progress: 0, label: "" };
}

function mp4Of(row: Record<string, unknown>): string | null {
  const direct = [row.mp4_url, row.mp4Url, row.download_url, row.downloadUrl, row.video_url, row.videoUrl, row.mp4];
  for (const value of direct) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const output = row.output ?? row.result;
  if (typeof output === "string" && /\.mp4($|\?)/i.test(output)) return output;
  if (output && typeof output === "object") {
    const box = output as Record<string, unknown>;
    const nested = box.mp4_url ?? box.mp4Url ?? box.url ?? box.download_url;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

export function parseJobStatus(json: unknown, fallbackId: string): JobSnapshot {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const row =
    root.job && typeof root.job === "object" ? (root.job as Record<string, unknown>) : root;
  const id = asId(row.id) ?? asId(row.job_id) ?? asId(row.jobId) ?? assertJobId(fallbackId);
  const status = phaseOf(typeof row.status === "string" ? row.status : typeof row.state === "string" ? row.state : "");
  const measured = progressOf(row);
  const label =
    measured.label ||
    (typeof row.label === "string" ? row.label : "") ||
    (typeof row.step === "string" ? row.step : "") ||
    (typeof row.stage === "string" ? row.stage : "");
  const message = typeof row.message === "string" ? row.message : "";
  const errorText = typeof row.error === "string" ? row.error : status === "error" ? message : "";
  const progress = status === "done" ? Math.max(measured.progress, 100) : measured.progress;
  return {
    id,
    status,
    progress,
    label: status === "error" ? "" : label || (status === "running" ? message : ""),
    error: errorText,
    mp4Url: mp4Of(row),
  };
}
