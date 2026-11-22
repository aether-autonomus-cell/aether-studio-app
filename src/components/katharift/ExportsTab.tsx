import { useState } from "react";
import { Download, FileCode2, FileText, Film, Sparkles } from "lucide-react";
import { krApiFetch, type WorkspaceSnapshot } from "./types";

interface ExportsTabProps {
  workspace: WorkspaceSnapshot;
  onRefresh: () => Promise<void>;
}

function triggerTextDownload(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportsTab({ workspace, onRefresh }: ExportsTabProps) {
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState(workspace.storyRevision.bible.title);
  const [thumbInput, setThumbInput] = useState("WATER REMEMBERS");
  const [auditResult, setAuditResult] = useState<{
    titleRes?: { ok: boolean; data: any; error: string | null };
    deadairRes?: { ok: boolean; data: any; error: string | null } | null;
  } | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  async function handleExport(format: "mp4_hi" | "mp4_en" | "srt_hi" | "srt_en" | "bundle_json") {
    setBusyFormat(format);
    try {
      const res = await krApiFetch<{
        export_id: string;
        status: string;
        file_name: string;
        content: string | null;
        mime: string;
      }>("/api/kr/exports", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          format,
        }),
      });
      if (res.content !== null) {
        triggerTextDownload(res.file_name, res.content, res.mime);
      }
      await onRefresh();
    } finally {
      setBusyFormat(null);
    }
  }

  async function handleRunAudit(e: React.FormEvent) {
    e.preventDefault();
    setAuditBusy(true);
    try {
      const res = await krApiFetch<{
        titleRes: { ok: boolean; data: any; error: string | null };
        deadairRes: { ok: boolean; data: any; error: string | null } | null;
      }>("/api/kr/skills/run", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          mode: "packaging_audit",
          title: titleInput,
          thumbnail_text: thumbInput,
        }),
      });
      setAuditResult(res);
      await onRefresh();
    } finally {
      setAuditBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Direct Exports */}
      <section className="kr-card rounded-2xl p-4">
        <h2 className="text-base font-semibold text-white">
          Exports from Timeline v{workspace.timeline.version}
        </h2>
        <p className="mt-1 text-xs text-[var(--kr-muted)]">
          Captions (.srt) and edit bundles (.json) build directly from your edited timeline. Full
          edited MP4s are queued for your paired Colab/local FFmpeg worker (never faked on phone).
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            disabled={busyFormat !== null}
            onClick={() => handleExport("srt_hi")}
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div className="flex items-center gap-2.5">
              <FileText className="h-4 w-4 text-violet-300" />
              <div>
                <div className="text-sm font-medium text-white">Hindi Subtitles (.srt)</div>
                <div className="text-[11px] text-[var(--kr-muted)]">Instant download</div>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-300" />
          </button>

          <button
            type="button"
            disabled={busyFormat !== null}
            onClick={() => handleExport("srt_en")}
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div className="flex items-center gap-2.5">
              <FileText className="h-4 w-4 text-sky-300" />
              <div>
                <div className="text-sm font-medium text-white">English Subtitles (.srt)</div>
                <div className="text-[11px] text-[var(--kr-muted)]">Instant download</div>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-300" />
          </button>

          <button
            type="button"
            disabled={busyFormat !== null}
            onClick={() => handleExport("bundle_json")}
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div className="flex items-center gap-2.5">
              <FileCode2 className="h-4 w-4 text-emerald-300" />
              <div>
                <div className="text-sm font-medium text-white">Timeline Edit Bundle (.json)</div>
                <div className="text-[11px] text-[var(--kr-muted)]">24fps/48kHz EDL + SRT</div>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-300" />
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyFormat !== null}
              onClick={() => handleExport("mp4_hi")}
              className="kr-tap flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-3 text-xs font-semibold text-white hover:bg-violet-500"
            >
              <Film className="h-4 w-4" /> Queue HI MP4
            </button>
            <button
              type="button"
              disabled={busyFormat !== null}
              onClick={() => handleExport("mp4_en")}
              className="kr-tap flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600/80 px-3 py-3 text-xs font-semibold text-white hover:bg-violet-500"
            >
              <Film className="h-4 w-4" /> Queue EN MP4
            </button>
          </div>
        </div>
      </section>

      {/* Real Vendored YouTube Packaging & Dead-Air Skill Audit */}
      <section className="kr-card rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-violet-400" />
          YouTube Packaging & Dead-Air Check (Real Skill Tools)
        </h3>
        <form onSubmit={handleRunAudit} className="mt-3 flex flex-col gap-2.5">
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Video title"
            className="kr-input kr-tap rounded-xl px-3 py-2 text-sm"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={thumbInput}
              onChange={(e) => setThumbInput(e.target.value)}
              placeholder="Thumbnail text"
              className="kr-input kr-tap flex-1 rounded-xl px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={auditBusy}
              className="kr-tap rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500"
            >
              {auditBusy ? "Running…" : "Run Skill Audit"}
            </button>
          </div>
        </form>

        {auditResult?.titleRes && (
          <div className="mt-3 rounded-xl bg-black/35 p-3 text-xs">
            <div className="font-semibold text-violet-300">title.py + deadair.py Output</div>
            <pre className="mt-1 overflow-x-auto text-[11px] text-slate-200">
              {JSON.stringify(
                {
                  title_lint: auditResult.titleRes.data,
                  deadair: auditResult.deadairRes?.data ?? null,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </section>

      {/* Export History */}
      <section className="kr-card rounded-2xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
          Recent Exports ({workspace.exports.length})
        </h3>
        {workspace.exports.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--kr-muted)]">No exports generated yet.</p>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            {workspace.exports.map((exp) => (
              <div
                key={exp.export_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs"
              >
                <div>
                  <div className="font-medium text-white">{exp.file_name}</div>
                  <div className="text-[11px] text-[var(--kr-muted)]">
                    {exp.format} · {exp.byte_size > 0 ? `${exp.byte_size} bytes` : "worker queued"}
                  </div>
                  {exp.error_message && (
                    <div className="mt-1 text-[11px] text-amber-300">{exp.error_message}</div>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    exp.status === "ready"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : exp.status === "queued"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {exp.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
