import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Download, FileCode2, FileText, Film, Sparkles } from "lucide-react";
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
  const [exportFeedback, setExportFeedback] = useState<{
    kind: "ready" | "queued" | "error";
    text: string;
  } | null>(null);
  const [titleInput, setTitleInput] = useState(workspace.storyRevision.bible.title);
  const [thumbInput, setThumbInput] = useState("WATER REMEMBERS");
  const [auditResult, setAuditResult] = useState<{
    titleRes?: { ok: boolean; data: any; error: string | null };
    deadairRes?: { ok: boolean; data: any; error: string | null } | null;
  } | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  const youtubeSkill = workspace.skillsReport.skills.find(
    (s) => s.skill_id === "youtube.agent",
  );
  const youtubeExecutable = Boolean(youtubeSkill?.execution_ready);

  const activeHiMp4 = workspace.exports.find(
    (e) =>
      e.timeline_revision_id === workspace.timelineRevisionId &&
      e.format === "mp4_hi" &&
      (e.status === "queued" || e.status === "rendering"),
  );
  const activeEnMp4 = workspace.exports.find(
    (e) =>
      e.timeline_revision_id === workspace.timelineRevisionId &&
      e.format === "mp4_en" &&
      (e.status === "queued" || e.status === "rendering"),
  );

  async function handleExport(format: "mp4_hi" | "mp4_en" | "srt_hi" | "srt_en" | "bundle_json") {
    setBusyFormat(format);
    setExportFeedback(null);
    try {
      const res = await krApiFetch<{
        export_id: string;
        status: string;
        file_name: string;
        content: string | null;
        mime: string;
        deduplicated?: boolean;
        message?: string;
      }>("/api/kr/exports", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          format,
        }),
      });
      if (res.content !== null) {
        triggerTextDownload(res.file_name, res.content, res.mime);
        setExportFeedback({
          kind: "ready",
          text: res.message ?? `Downloaded ${res.file_name}.`,
        });
      } else {
        setExportFeedback({
          kind: "queued",
          text:
            res.message ??
            `Queued, not rendered; worker/media required — ${res.file_name}.`,
        });
      }
      await onRefresh();
    } catch (err) {
      setExportFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Export failed",
      });
    } finally {
      setBusyFormat(null);
    }
  }

  async function handleRunAudit(e: React.FormEvent) {
    e.preventDefault();
    setAuditBusy(true);
    setAuditError(null);
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
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Skill audit failed");
    } finally {
      setAuditBusy(false);
    }
  }

  const titleResError =
    auditResult?.titleRes && !auditResult.titleRes.ok
      ? auditResult.titleRes.error || "Title lint tool unavailable."
      : null;
  const deadairResError =
    auditResult?.deadairRes && !auditResult.deadairRes.ok
      ? auditResult.deadairRes.error || "Dead-air tool unavailable."
      : null;
  const hasAnySuccessData = Boolean(
    (auditResult?.titleRes?.ok && auditResult.titleRes.data !== null) ||
      (auditResult?.deadairRes?.ok && auditResult.deadairRes.data !== null),
  );

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
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10 disabled:opacity-50"
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
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10 disabled:opacity-50"
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
            className="kr-tap flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10 disabled:opacity-50"
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
              className={`kr-tap flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-xs font-semibold text-white disabled:opacity-50 ${
                activeHiMp4
                  ? "border border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
                  : "bg-violet-600 hover:bg-violet-500"
              }`}
            >
              {activeHiMp4 ? <Clock className="h-4 w-4" /> : <Film className="h-4 w-4" />}
              {busyFormat === "mp4_hi"
                ? "Queuing…"
                : activeHiMp4
                  ? "HI MP4 Queued"
                  : "Queue HI MP4"}
            </button>
            <button
              type="button"
              disabled={busyFormat !== null}
              onClick={() => handleExport("mp4_en")}
              className={`kr-tap flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-xs font-semibold text-white disabled:opacity-50 ${
                activeEnMp4
                  ? "border border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
                  : "bg-violet-600/80 hover:bg-violet-500"
              }`}
            >
              {activeEnMp4 ? <Clock className="h-4 w-4" /> : <Film className="h-4 w-4" />}
              {busyFormat === "mp4_en"
                ? "Queuing…"
                : activeEnMp4
                  ? "EN MP4 Queued"
                  : "Queue EN MP4"}
            </button>
          </div>
        </div>

        {exportFeedback && (
          <div
            data-testid="export-feedback-banner"
            className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
              exportFeedback.kind === "ready"
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                : exportFeedback.kind === "queued"
                  ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                  : "border-rose-500/35 bg-rose-500/10 text-rose-200"
            }`}
          >
            {exportFeedback.kind === "ready" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            ) : exportFeedback.kind === "queued" ? (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            )}
            <span>{exportFeedback.text}</span>
          </div>
        )}
      </section>

      {/* Real Vendored YouTube Packaging & Dead-Air Skill Audit */}
      <section className="kr-card rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-violet-400" />
            YouTube Packaging & Dead-Air Check (Real Skill Tools)
          </h3>
          {youtubeSkill && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                youtubeExecutable
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {youtubeExecutable ? "runtime: ready" : `runtime: ${youtubeSkill.status}`}
            </span>
          )}
        </div>

        {youtubeSkill && !youtubeExecutable && (
          <div
            data-testid="audit-runtime-unavailable"
            className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>
              <strong>Files provisioned ({youtubeSkill.verified_files}/{youtubeSkill.total_files}), execution unavailable here:</strong>{" "}
              {youtubeSkill.execution_note}
            </div>
          </div>
        )}

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
              disabled={auditBusy || !youtubeExecutable}
              className="kr-tap rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-45"
            >
              {auditBusy
                ? "Running…"
                : youtubeExecutable
                  ? "Run Skill Audit"
                  : "Requires Worker / Python3"}
            </button>
          </div>
        </form>

        {(auditError || titleResError || deadairResError) && (
          <div className="mt-3 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200">
            {auditError && <p>{auditError}</p>}
            {titleResError && <p>title.py: {titleResError}</p>}
            {deadairResError && <p>deadair.py: {deadairResError}</p>}
          </div>
        )}

        {hasAnySuccessData && auditResult && (
          <div className="mt-3 rounded-xl bg-black/35 p-3 text-xs">
            <div className="font-semibold text-violet-300">title.py + deadair.py Output</div>
            <pre className="mt-1 overflow-x-auto text-[11px] text-slate-200">
              {JSON.stringify(
                {
                  ...(auditResult.titleRes?.ok ? { title_lint: auditResult.titleRes.data } : {}),
                  ...(auditResult.deadairRes?.ok ? { deadair: auditResult.deadairRes.data } : {}),
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
            {workspace.exports.map((exp) => {
              const isTextDownload =
                exp.status === "ready" &&
                (exp.format === "srt_hi" ||
                  exp.format === "srt_en" ||
                  exp.format === "bundle_json");
              const hasRealArtifact =
                isTextDownload || (exp.status === "ready" && Boolean(exp.drive_file_id));

              return (
                <div
                  key={exp.export_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{exp.file_name}</div>
                    <div className="text-[11px] text-[var(--kr-muted)]">
                      {exp.format} ·{" "}
                      {exp.status === "ready" && exp.byte_size > 0
                        ? `${exp.byte_size} bytes`
                        : "queued, not rendered"}
                    </div>
                    {exp.error_message && (
                      <div className="mt-1 text-[11px] text-amber-300">{exp.error_message}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {hasRealArtifact && isTextDownload && (
                      <button
                        type="button"
                        disabled={busyFormat !== null}
                        onClick={() =>
                          handleExport(
                            exp.format as "srt_hi" | "srt_en" | "bundle_json",
                          )
                        }
                        className="kr-tap inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                      >
                        <Download className="h-3 w-3" /> Rebuild
                      </button>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        exp.status === "ready"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : exp.status === "queued" || exp.status === "rendering"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {exp.status === "queued" ? "queued · not rendered" : exp.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
