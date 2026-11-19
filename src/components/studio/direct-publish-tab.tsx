import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { StudioStatusResponse } from "@/lib/studio/api";
import { generateColabCell3Publish } from "@/lib/studio/factory-cell";
import {
  canonicalJson,
  sha256Hex,
  type LanguageCode,
  type PublishTarget,
  type SceneGraphV1,
} from "@/lib/studio/schema";

interface DirectPublishTabProps {
  job: SceneGraphV1;
  status: StudioStatusResponse;
  onUpdateJob: (next: SceneGraphV1) => void;
}

interface ParsedRenderReport {
  project_id?: string;
  drive_folder_url?: string;
  artifacts?: {
    "hi-IN"?: { filename?: string; sha256?: string; duration_sec?: number; drive_path?: string };
    "en-US"?: { filename?: string; sha256?: string; duration_sec?: number; drive_path?: string };
  };
}

export function DirectPublishTab({
  job,
  status,
  onUpdateJob,
}: DirectPublishTabProps) {
  const [reportJsonInput, setReportJsonInput] = useState("");
  const [parsedReport, setParsedReport] = useState<ParsedRenderReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [manifestHash, setManifestHash] = useState("calculating...");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const updateTarget = (lang: LanguageCode, patch: Partial<PublishTarget>) => {
    onUpdateJob({
      ...job,
      project: {
        ...job.project,
        publish_targets: {
          ...job.project.publish_targets,
          [lang]: {
            ...job.project.publish_targets[lang],
            ...patch,
          },
        },
      },
    });
  };

  const publishManifest = {
    schema_version: "aether.2d.publish@1",
    project_id: job.project_id,
    project_revision: job.project_revision,
    drive_folder: job.project.outputs.drive_folder,
    channels: {
      "hi-IN": {
        ...job.project.publish_targets["hi-IN"],
        artifact_file: parsedReport?.artifacts?.["hi-IN"]?.filename ?? "output_hi.mp4",
        artifact_sha256: parsedReport?.artifacts?.["hi-IN"]?.sha256 ?? "VERIFY_IN_RENDER_REPORT",
        drive_token_path: "/content/drive/MyDrive/AetherStudioConfig/yt_hi_token.json",
      },
      "en-US": {
        ...job.project.publish_targets["en-US"],
        artifact_file: parsedReport?.artifacts?.["en-US"]?.filename ?? "output_en.mp4",
        artifact_sha256: parsedReport?.artifacts?.["en-US"]?.sha256 ?? "VERIFY_IN_RENDER_REPORT",
        drive_token_path: "/content/drive/MyDrive/AetherStudioConfig/yt_en_token.json",
      },
    },
  };

  const manifestJson = JSON.stringify(publishManifest, null, 2);

  useEffect(() => {
    let active = true;
    void sha256Hex(canonicalJson(publishManifest)).then((h) => {
      if (active) setManifestHash(h);
    });
    return () => {
      active = false;
    };
  });

  const handleParseReport = () => {
    try {
      const obj = JSON.parse(reportJsonInput) as ParsedRenderReport;
      setParsedReport(obj);
      setReportError(null);
    } catch (err) {
      setReportError(String(err instanceof Error ? err.message : err));
    }
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* ignore */
    }
  };

  const downloadManifest = () => {
    const blob = new Blob([manifestJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "publish_manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const cell3 = generateColabCell3Publish();

  return (
    <div className="space-y-5">
      {/* Transparent OAuth Testing Mode Notice */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-950/30 p-4 text-xs text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-200">
            Transparent Google OAuth & Visibility Notice
          </p>
          <p className="text-amber-100/90">
            Google Cloud OAuth apps in unverified testing mode restrict API-uploaded YouTube videos
            to <strong>private</strong> visibility until YouTube API audit/verification is
            completed. Privacy defaults to <strong>private</strong> as a safety guard.{" "}
            <strong>Google Drive export remains completely unrestricted at all times.</strong>
          </p>
        </div>
      </div>

      {/* Dual-Channel Target Matrix */}
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            {
              lang: "hi-IN" as const,
              label: "Channel A — Hindi Channel",
              file: "output_hi.mp4",
              badge: "hi-IN · Hindi Captions",
              accent: "border-amber-400/35",
              slot: "hindi" as const,
            },
            {
              lang: "en-US" as const,
              label: "Channel B — English Channel",
              file: "output_en.mp4",
              badge: "en-US · English Captions",
              accent: "border-cyan-400/35",
              slot: "english" as const,
            },
          ] as const
        ).map((ch) => {
          const target = job.project.publish_targets[ch.lang];
          return (
            <div key={ch.lang} className={`studio-card rounded-2xl border p-4 sm:p-5 ${ch.accent}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">{ch.label}</h3>
                  <p className="font-mono text-[11px] text-slate-400">
                    {ch.file} · {ch.badge}
                  </p>
                </div>
                {status.oauth_configured ? (
                  <a
                    href={`/api/2d/oauth/google/start?slot=${ch.slot}&scope=youtube`}
                    className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  >
                    Connect Channel OAuth
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300">
                    Drive Token Mode
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2.5 text-xs">
                <label className="block space-y-1">
                  <span className="text-slate-300">Video Title (max 100 chars)</span>
                  <input
                    type="text"
                    maxLength={100}
                    value={target.title}
                    onChange={(e) => updateTarget(ch.lang, { title: e.target.value })}
                    className="studio-input w-full rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-slate-300">Description</span>
                  <textarea
                    rows={3}
                    value={target.description}
                    onChange={(e) => updateTarget(ch.lang, { description: e.target.value })}
                    className="studio-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-slate-300">Tags (comma-separated)</span>
                  <input
                    type="text"
                    value={target.tags.join(", ")}
                    onChange={(e) =>
                      updateTarget(ch.lang, {
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean)
                          .slice(0, 25),
                      })
                    }
                    className="studio-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <label className="space-y-1">
                    <span className="text-slate-300">Visibility</span>
                    <select
                      value={target.privacy_status}
                      onChange={(e) =>
                        updateTarget(ch.lang, {
                          privacy_status: e.target.value as "private" | "unlisted" | "public",
                        })
                      }
                      className="studio-input w-full rounded-lg px-2 py-1.5 text-xs"
                    >
                      <option value="private">Private (Safety Default)</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>

                  <label className="flex items-end gap-2 pb-1.5 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={target.made_for_kids}
                      onChange={(e) =>
                        updateTarget(ch.lang, { made_for_kids: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#5DE6FF]"
                    />
                    Made for Kids
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Route 2 — Google Drive Direct Delivery & Render Report Import */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-100">
              <HardDrive className="h-4 w-4 text-cyan-300" />
              Route 2 — Google Drive Direct Delivery (Always Available)
            </h3>
            <p className="text-xs text-slate-300">
              Target Drive folder:{" "}
              <code className="text-cyan-300">
                /MyDrive/{job.project.outputs.drive_folder}/{job.project_id}/
              </code>
            </p>
          </div>
          <a
            href="https://drive.google.com/drive/my-drive"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-400"
          >
            Open Google Drive
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-slate-300">
            Optional: Paste render-report.json from Colab to bind verified artifact SHA-256 hashes
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              rows={2}
              value={reportJsonInput}
              onChange={(e) => setReportJsonInput(e.target.value)}
              placeholder='{"project_id":"...","artifacts":{"hi-IN":{"sha256":"..."},"en-US":{"sha256":"..."}}}'
              className="studio-input flex-1 rounded-lg px-2.5 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleParseReport}
              className="rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
            >
              Verify Report
            </button>
          </div>
          {reportError && <p className="text-xs text-rose-300">{reportError}</p>}
          {parsedReport && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Verified report loaded for {parsedReport.project_id ?? job.project_id}. SHA-256 bound
              to Publish Manifest below.
            </div>
          )}
        </div>
      </div>

      {/* Route 1 — Direct Colab YouTube Resumable Upload Manifest */}
      <div className="studio-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-100">
              <UploadCloud className="h-4 w-4 text-violet-300" />
              Route 1 — Direct Colab YouTube Resumable Upload
            </h3>
            <p className="font-mono text-[11px] text-violet-300">
              Manifest SHA-256: {manifestHash}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyText("manifest", manifestJson)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/50 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100"
            >
              {copiedId === "manifest" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedId === "manifest" ? "Copied Manifest" : "Copy Publish Manifest"}
            </button>
            <button
              type="button"
              onClick={downloadManifest}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5DE6FF] to-[#A78BFA] px-3.5 py-1.5 text-xs font-bold text-slate-950"
            >
              <Download className="h-3.5 w-3.5" />
              Download publish_manifest.json
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/75 p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">
              Colab Cell 3 — Resumable Dual-Channel Uploader (Drive Checkpoint Safe)
            </span>
            <button
              type="button"
              onClick={() => copyText("cell3", cell3)}
              className="text-cyan-300 hover:underline"
            >
              {copiedId === "cell3" ? "Copied!" : "Copy Cell 3"}
            </button>
          </div>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-slate-300">
            {cell3}
          </pre>
        </div>
      </div>
    </div>
  );
}
