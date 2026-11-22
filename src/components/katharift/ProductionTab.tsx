import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Cpu, KeyRound, PauseCircle, RefreshCw } from "lucide-react";
import { KR_SCENE_STAGES, type KrSceneStage } from "@/packages/contracts/schemas";
import { krApiFetch, type WorkspaceSnapshot } from "./types";

interface ProductionTabProps {
  workspace: WorkspaceSnapshot;
  onRefresh: () => Promise<void>;
}

const WATERFALL_DISPLAY_STAGES: readonly KrSceneStage[] = KR_SCENE_STAGES.filter(
  (s) => s !== "queued" && s !== "failed",
);

export function ProductionTab({ workspace, onRefresh }: ProductionTabProps) {
  const [pairingInfo, setPairingInfo] = useState<{
    worker_session_id: string;
    pairing_code: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const latestJob = workspace.jobs[0] ?? null;

  async function handleGeneratePairingCode() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await krApiFetch<{
        worker_session_id: string;
        pairing_code: string;
      }>("/api/kr/jobs/pair", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          runtime_kind: "colab_free_gpu",
        }),
      });
      setPairingInfo(res);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate pairing code");
    } finally {
      setBusy(false);
    }
  }

  const colabCommand = pairingInfo
    ? `python3 worker/colab_worker.py --app-url "${typeof window !== "undefined" ? window.location.origin : ""}" --pairing-code "${pairingInfo.pairing_code}" --mode colab`
    : "";

  async function copyCommand() {
    if (!colabCommand) return;
    await navigator.clipboard.writeText(colabCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Colab Free GPU Worker Pairing Card */}
      <section className="kr-card rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Cpu className="h-4 w-4 text-violet-400" />
              Bounded Colab GPU Worker
            </h2>
            <p className="mt-1 text-xs text-[var(--kr-muted)]">
              User-started free Colab GPU session. Runs FLUX.2 Klein 4B (1344×768) + HI/EN voices +
              HyperFrames compose sequentially.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRefresh()}
              className="kr-tap inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleGeneratePairingCode}
              className="kr-tap inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {busy ? "Generating…" : "Pair Worker"}
            </button>
          </div>
        </div>

        {pairingInfo && (
          <div className="mt-3 rounded-xl border border-violet-500/30 bg-black/40 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--kr-muted)]">Short-lived Pairing Code:</span>
              <span className="font-mono text-sm font-bold text-violet-300">
                {pairingInfo.pairing_code}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="block flex-1 overflow-x-auto rounded-lg bg-black/60 p-2 font-mono text-[11px] text-slate-200">
                {colabCommand}
              </code>
              <button
                type="button"
                onClick={copyCommand}
                className="kr-tap shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            {copied && <p className="mt-1 text-[11px] text-emerald-300">Command copied.</p>}
          </div>
        )}

        {errorMsg && (
          <p className="mt-2 text-xs text-rose-300">{errorMsg}</p>
        )}

        {/* Active / Recent Worker Sessions */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {workspace.workerSessions.length === 0 ? (
            <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[var(--kr-muted)]">
              No worker paired yet (waiting for user-started Colab session)
            </span>
          ) : (
            workspace.workerSessions.slice(0, 2).map((ws) => (
              <span
                key={ws.worker_session_id}
                className={`rounded-lg px-2.5 py-1 ${
                  ws.status === "active"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-white/5 text-[var(--kr-muted)]"
                }`}
              >
                {ws.gpu_name ?? ws.runtime_kind} · {ws.status}
              </span>
            ))
          )}
        </div>
      </section>

      {/* Scene-by-Scene Waterfall Tracker */}
      {!latestJob ? (
        <section className="kr-card rounded-2xl p-6 text-center">
          <Clock className="mx-auto h-7 w-7 text-[var(--kr-muted)]" />
          <h3 className="mt-2 text-base font-semibold text-white">No Confirmed Production Job Yet</h3>
          <p className="mt-1 text-xs text-[var(--kr-muted)]">
            Review your scenes in the Story tab and tap <strong>Confirm Production</strong> to queue
            an idempotent <code className="text-violet-300">kr.job.v1</code> job.
          </p>
        </section>
      ) : (
        <section className="kr-card rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-violet-300">{latestJob.job_id}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    latestJob.status === "completed"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : latestJob.status === "failed"
                        ? "bg-rose-500/15 text-rose-300"
                        : latestJob.status === "paused_quota"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-violet-500/15 text-violet-300"
                  }`}
                >
                  {latestJob.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--kr-muted)]">
                Sequential waterfall · failure on any scene blocks the next scene
              </p>
            </div>
            <span className="text-xs text-[var(--kr-muted)]">
              {latestJob.checkpoints.filter((c) => c.status === "completed").length} /{" "}
              {latestJob.checkpoints.length} ready
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {latestJob.checkpoints.map((cp, idx) => {
              const scene = latestJob.scenes[idx];
              const stageIdx = WATERFALL_DISPLAY_STAGES.indexOf(cp.stage);
              const prevFailedOrPending =
                idx > 0 && latestJob.checkpoints[idx - 1].status !== "completed";

              return (
                <div
                  key={cp.scene_id}
                  className="rounded-xl border border-white/10 bg-black/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {cp.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : cp.status === "failed" ? (
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                      ) : prevFailedOrPending ? (
                        <PauseCircle className="h-4 w-4 text-slate-500" />
                      ) : (
                        <Clock className="h-4 w-4 text-violet-400" />
                      )}
                      <span className="text-sm font-medium text-white">
                        Scene {idx + 1}: {scene?.title ?? cp.scene_id}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--kr-muted)]">
                      {prevFailedOrPending && cp.status === "pending"
                        ? "blocked until previous scene finishes"
                        : `${cp.stage} · ${cp.status}`}
                    </span>
                  </div>

                  {/* 9-stage horizontal chips */}
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {WATERFALL_DISPLAY_STAGES.map((st, sIdx) => {
                      const done =
                        cp.status === "completed" || (stageIdx >= 0 && sIdx <= stageIdx && cp.status !== "failed");
                      const failedHere = cp.status === "failed" && cp.stage === st;
                      return (
                        <span
                          key={st}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            failedHere
                              ? "bg-rose-500/25 text-rose-200"
                              : done
                                ? "bg-violet-500/25 text-violet-200"
                                : "bg-white/5 text-slate-500"
                          }`}
                        >
                          {st}
                        </span>
                      );
                    })}
                  </div>

                  {cp.error_message && (
                    <p className="mt-2 text-xs text-rose-300">{cp.error_message}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Monotonic Worker Events */}
      {workspace.workerEvents.length > 0 && (
        <section className="kr-card rounded-2xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
            Worker Event Stream
          </h3>
          <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto font-mono text-[11px]">
            {workspace.workerEvents.map((ev) => (
              <div
                key={ev.event_id}
                className={`rounded px-2 py-1 ${
                  ev.level === "error"
                    ? "bg-rose-500/10 text-rose-200"
                    : "bg-black/30 text-slate-300"
                }`}
              >
                <span className="text-violet-300">#{ev.seq}</span> [{ev.scene_id ?? "-"}:{ev.stage}]{" "}
                {ev.message}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
