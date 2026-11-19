import { useEffect, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  Download,
  HardDrive,
  Laptop,
  Play,
  Terminal,
} from "lucide-react";
import {
  cancelCloudJob,
  createCloudJob,
  fetchCloudJob,
  type CloudJobRecord,
  type StudioStatusResponse,
} from "@/lib/studio/api";
import {
  generateColabCell1Preflight,
  generateColabCell2Render,
} from "@/lib/studio/factory-cell";
import { saveLocalRenderRecord } from "@/lib/studio/persist";
import {
  canonicalJson,
  sha256Hex,
  type Fps,
  type LanguageCode,
  type Resolution,
  type SceneGraphV1,
} from "@/lib/studio/schema";

interface ColabRenderTabProps {
  job: SceneGraphV1;
  status: StudioStatusResponse;
  onUpdateJob: (next: SceneGraphV1) => void;
}

const BGM_OPTIONS = [
  { id: "", label: "None (Pure Voice)" },
  { id: "cc-obsidian-pulse", label: "Obsidian Pulse (Procedural CC0)" },
  { id: "cc-midnight-synth", label: "Midnight Synth (Procedural CC0)" },
];

export function ColabRenderTab({ job, status, onUpdateJob }: ColabRenderTabProps) {
  const [packetHash, setPacketHash] = useState<string>("calculating...");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [driveFileId, setDriveFileId] = useState(job.project.bgm?.drive_file_id ?? "");

  // Cloud Mode B state
  const [cloudJob, setCloudJob] = useState<CloudJobRecord | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpires, setPairingExpires] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  const packetJson = JSON.stringify(job, null, 2);

  useEffect(() => {
    let active = true;
    void sha256Hex(canonicalJson(job)).then((digest) => {
      if (active) setPacketHash(digest);
    });
    return () => {
      active = false;
    };
  }, [job]);

  useEffect(() => {
    if (!cloudJob || cloudJob.status === "saved" || cloudJob.status === "failed" || cloudJob.status === "cancelled") {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchCloudJob(cloudJob.job_id)
        .then((fresh) => setCloudJob(fresh))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [cloudJob]);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* ignore clipboard deny */
    }
  };

  const downloadJobPacket = async () => {
    const blob = new Blob([packetJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aether_job.json";
    a.click();
    URL.revokeObjectURL(url);

    await saveLocalRenderRecord({
      render_id: `local_${Date.now()}`,
      project_id: job.project_id,
      created_at: new Date().toISOString(),
      languages: job.project.languages,
      resolution: job.project.resolution,
      fps: job.project.fps,
      packet_sha256: packetHash,
      drive_folder: job.project.outputs.drive_folder,
    });
  };

  const handleStartCloudPairing = async () => {
    setCloudBusy(true);
    setCloudError(null);
    try {
      const idem = `${job.project_id}:r${job.project_revision}:${packetHash.slice(0, 12)}`;
      const res = await createCloudJob(job, idem);
      setCloudJob(res.job);
      setPairingCode(res.pairingCode);
      setPairingExpires(res.expiresAt);
    } catch (err) {
      setCloudError(String(err instanceof Error ? err.message : err));
    } finally {
      setCloudBusy(false);
    }
  };

  const trackMode: "both" | "hi" | "en" =
    job.project.languages.includes("hi-IN") && job.project.languages.includes("en-US")
      ? "both"
      : job.project.languages.includes("hi-IN")
        ? "hi"
        : "en";

  const setTracks = (m: "both" | "hi" | "en") => {
    const languages: LanguageCode[] =
      m === "both" ? ["hi-IN", "en-US"] : m === "hi" ? ["hi-IN"] : ["en-US"];
    onUpdateJob({ ...job, project: { ...job.project, languages } });
  };

  const cell1 = generateColabCell1Preflight();
  const cell2 = generateColabCell2Render(status.mode === "cloud-ready" && pairingCode ? "mode-b" : "mode-a");

  return (
    <div className="space-y-5">
      {/* Export Controls */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-50">
              Colab Interactive Render & Drive Export
            </h2>
            <p className="text-xs text-slate-300">
              Zero MP4 bytes ever proxy through Vercel. Colab renders deterministically and saves to
              Google Drive.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">
            {status.mode === "cloud-ready" ? (
              <>
                <Cloud className="h-3.5 w-3.5" /> Mode B: Cloud Queue Ready
              </>
            ) : (
              <>
                <Laptop className="h-3.5 w-3.5" /> Mode A: Zero-Setup Ready
              </>
            )}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span className="text-slate-300">Resolution</span>
            <select
              value={job.project.resolution}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: { ...job.project, resolution: e.target.value as Resolution },
                })
              }
              className="studio-input w-full rounded-lg px-2.5 py-2 text-sm"
            >
              <option value="1080p">1080p Full HD</option>
              <option value="540p">540p Fast Draft</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-slate-300">Frame Rate</span>
            <select
              value={job.project.fps}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: { ...job.project, fps: Number(e.target.value) as Fps },
                })
              }
              className="studio-input w-full rounded-lg px-2.5 py-2 text-sm"
            >
              <option value={30}>30 fps (Smooth)</option>
              <option value={24}>24 fps (Anime Cadence)</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-slate-300">Target Render Tracks</span>
            <select
              value={trackMode}
              onChange={(e) => setTracks(e.target.value as "both" | "hi" | "en")}
              className="studio-input w-full rounded-lg px-2.5 py-2 text-sm"
            >
              <option value="both">Dual Batch (HI + EN MP4s)</option>
              <option value="hi">Hindi Only (output_hi.mp4)</option>
              <option value="en">English Only (output_en.mp4)</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-slate-300">BGM Sidechain Ducking</span>
            <select
              value={job.project.bgm?.track_id ?? ""}
              onChange={(e) => {
                const trackId = e.target.value;
                onUpdateJob({
                  ...job,
                  project: {
                    ...job.project,
                    bgm: trackId
                      ? { track_id: trackId, volume: 0.14, drive_file_id: driveFileId || undefined }
                      : null,
                  },
                });
              }}
              className="studio-input w-full rounded-lg px-2.5 py-2 text-sm"
            >
              {BGM_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 pt-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
            <input
              type="checkbox"
              checked={job.project.outputs.save_to_drive}
              onChange={(e) =>
                onUpdateJob({
                  ...job,
                  project: {
                    ...job.project,
                    outputs: { ...job.project.outputs, save_to_drive: e.target.checked },
                  },
                })
              }
              className="h-4 w-4 accent-[#5DE6FF]"
            />
            <HardDrive className="h-4 w-4 text-cyan-300" />
            Auto-Save MP4s, SRT/VTT & report to Google Drive (/MyDrive/
            {job.project.outputs.drive_folder})
          </label>

          {job.project.bgm && (
            <input
              type="text"
              value={driveFileId}
              onChange={(e) => {
                setDriveFileId(e.target.value);
                onUpdateJob({
                  ...job,
                  project: {
                    ...job.project,
                    bgm: {
                      ...job.project.bgm!,
                      drive_file_id: e.target.value.trim() || undefined,
                    },
                  },
                });
              }}
              placeholder="Optional Drive Audio File ID"
              className="studio-input rounded-lg px-2.5 py-1 text-xs"
            />
          )}
        </div>
      </div>

      {/* Mode A — Zero-Setup Handoff */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Mode A — Instant Zero-Setup Job Packet (aether_job.json)
            </h3>
            <p className="font-mono text-[11px] text-cyan-300">
              RFC-8785 SHA-256: {packetHash}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyText("packet", packetJson)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100"
            >
              {copiedId === "packet" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedId === "packet" ? "Copied JSON" : "Copy Job Packet JSON"}
            </button>
            <button
              type="button"
              onClick={downloadJobPacket}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5DE6FF] to-[#A78BFA] px-3.5 py-1.5 text-xs font-bold text-slate-950"
            >
              <Download className="h-3.5 w-3.5" />
              Download aether_job.json
            </button>
          </div>
        </div>

        {/* 20-line Colab Bootstrapper Cells */}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700/70 bg-slate-950/75 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                <Terminal className="h-3.5 w-3.5" />
                Colab Cell 1 — Preflight Bootstrapper
              </span>
              <button
                type="button"
                onClick={() => copyText("cell1", cell1)}
                className="text-xs font-medium text-cyan-300 hover:underline"
              >
                {copiedId === "cell1" ? "Copied!" : "Copy Cell 1"}
              </button>
            </div>
            <pre className="overflow-x-auto text-[11px] leading-relaxed text-slate-300">
              {cell1}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-950/75 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                <Play className="h-3.5 w-3.5" />
                Colab Cell 2 — Dual-Language Render
              </span>
              <button
                type="button"
                onClick={() => copyText("cell2", cell2)}
                className="text-xs font-medium text-cyan-300 hover:underline"
              >
                {copiedId === "cell2" ? "Copied!" : "Copy Cell 2"}
              </button>
            </div>
            <pre className="overflow-x-auto text-[11px] leading-relaxed text-slate-300">
              {cell2}
            </pre>
          </div>
        </div>
      </div>

      {/* Mode B — Optional Authenticated Cloud Pairing */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Mode B — Optional Cloud Pairing Queue
            </h3>
            <p className="text-xs text-slate-300">
              {status.mode === "cloud-ready"
                ? "DATABASE_URL detected: issue a 10-minute 12-character one-time Colab pairing code."
                : "DATABASE_URL is not set on this deployment — Mode A Zero-Setup Handoff above works immediately without any server secrets."}
            </p>
          </div>
          {status.mode === "cloud-ready" && (
            <button
              type="button"
              disabled={cloudBusy}
              onClick={handleStartCloudPairing}
              className="rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {cloudBusy ? "Issuing..." : "Create Cloud Snapshot & Pairing Code"}
            </button>
          )}
        </div>

        {cloudError && (
          <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {cloudError}
          </p>
        )}

        {cloudJob && (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-700/70 bg-slate-950/70 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-cyan-300">
                Job: {cloudJob.job_id} · Phase: <strong>{cloudJob.phase}</strong> ({cloudJob.status})
              </span>
              {(cloudJob.status === "queued" || cloudJob.status === "running") && (
                <button
                  type="button"
                  onClick={() => void cancelCloudJob(cloudJob.job_id)}
                  className="text-rose-300 hover:underline"
                >
                  Cancel Job
                </button>
              )}
            </div>
            {pairingCode && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-950/40 p-2.5">
                <span className="text-emerald-200">One-Time Pairing Code:</span>
                <code className="rounded bg-black/50 px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-emerald-300">
                  {pairingCode}
                </code>
                {pairingExpires && (
                  <span className="text-[11px] text-slate-400">
                    Expires {new Date(pairingExpires).toLocaleTimeString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
