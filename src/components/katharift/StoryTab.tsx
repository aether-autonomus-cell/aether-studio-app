import { useState } from "react";
import {
  Check,
  GitBranch,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import type { KrStoryPatch } from "@/packages/contracts/schemas";
import { krApiFetch, type WorkspaceSnapshot } from "./types";

interface StoryTabProps {
  workspace: WorkspaceSnapshot;
  draftInstruction: string;
  onDraftInstructionChange: (next: string) => void;
  onRefresh: () => Promise<void>;
  onNavigateProduction: () => void;
}

export function StoryTab({
  workspace,
  draftInstruction,
  onDraftInstructionChange,
  onRefresh,
  onNavigateProduction,
}: StoryTabProps) {
  const [busy, setBusy] = useState(false);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const { storyRevision, settingsRevision, patches } = workspace;
  const pendingPatches = patches.filter((p) => p.status === "pending" || p.status === "rebased");

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    if (!draftInstruction.trim() || busy) return;
    setBusy(true);
    setAssistantNote(null);
    setErrorMsg(null);
    try {
      const res = await krApiFetch<{
        patch: KrStoryPatch;
        assistantMessage: string;
        instructionsLoaded: Array<{ skill_id: string; file_path: string }>;
      }>("/api/kr/story/propose", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          instruction: draftInstruction.trim(),
          expected_story_revision_id: storyRevision.revision_id,
        }),
      });
      setAssistantNote(
        `${res.assistantMessage} (${res.instructionsLoaded.length} licensed skill guide(s) consulted.)`,
      );
      onDraftInstructionChange("");
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to propose patch");
    } finally {
      setBusy(false);
    }
  }

  async function handlePatchAction(patchId: string, action: "accept" | "reject" | "rebase") {
    setBusy(true);
    setErrorMsg(null);
    try {
      await krApiFetch("/api/kr/story/patch", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          patch_id: patchId,
          action,
        }),
      });
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Failed to ${action} patch`);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleCanonLock(sceneId: string, locked: boolean) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await krApiFetch("/api/kr/story/patch", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          action: "toggle_canon_lock",
          scene_id: sceneId,
          locked,
        }),
      });
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to toggle canon lock");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmProduction() {
    setConfirmBusy(true);
    setErrorMsg(null);
    try {
      const idempotencyKey = `confirm_${storyRevision.revision_id}_${settingsRevision.settings_revision_id}`;
      await krApiFetch("/api/kr/jobs/confirm", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          idempotency_key: idempotencyKey,
          confirmed_by_user: true,
        }),
      });
      setConfirmOpen(false);
      await onRefresh();
      onNavigateProduction();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Production confirmation failed");
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Story Revision & Production Gate Summary */}
      <section className="kr-card rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--kr-muted)]">
              <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 font-medium text-violet-300">
                Story v{storyRevision.version}
              </span>
              <span>{storyRevision.bible.scenes.length} scenes</span>
              <span>· 1344×768 · 24fps</span>
            </div>
            <h2 className="mt-1.5 text-lg font-semibold text-white">
              {storyRevision.bible.title}
            </h2>
            <p className="mt-1 text-sm text-[var(--kr-muted)]">{storyRevision.bible.logline}</p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="kr-tap inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-500 active:scale-[0.99]"
          >
            <Play className="h-4 w-4" />
            Confirm Production
          </button>
        </div>
      </section>

      {/* Story Director Chat & Canon Patch Proposer */}
      <section className="kr-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-violet-400" />
            Story Director (Canon-Safe Diffs)
          </h3>
          <span className="text-xs text-[var(--kr-muted)]">
            Route: {settingsRevision.snapshot.director_route}
          </span>
        </div>

        <form onSubmit={handlePropose} className="mt-3 flex flex-col gap-2.5">
          <textarea
            rows={2}
            disabled={busy}
            value={draftInstruction}
            onChange={(e) => onDraftInstructionChange(e.target.value)}
            placeholder="Describe a story edit (e.g., 'Scene 2 mein halki baarish add karo' or 'Add a dawn ending scene')..."
            className="kr-input w-full rounded-xl px-3.5 py-2.5 text-sm disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                "Add monsoon rain mood",
                "Tighten Hindi pacing",
                "Add dawn ending scene",
              ].map((chip) => {
                const selected = draftInstruction.trim() === chip;
                return (
                  <button
                    key={chip}
                    type="button"
                    disabled={busy}
                    onClick={() => onDraftInstructionChange(chip)}
                    className={`kr-tap rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                      selected
                        ? "border-violet-400/60 bg-violet-500/20 text-white"
                        : "border-white/10 bg-white/5 text-[var(--kr-muted)] hover:border-violet-400/40 hover:text-white"
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={busy || !draftInstruction.trim()}
              className="kr-tap rounded-xl bg-violet-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              {busy ? "Analyzing…" : "Propose Diff"}
            </button>
          </div>
        </form>

        {assistantNote && (
          <div className="mt-3 rounded-xl border border-violet-500/25 bg-violet-500/10 p-3 text-xs text-violet-100">
            {assistantNote}
          </div>
        )}
        {errorMsg && (
          <div className="mt-3 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}
      </section>

      {/* Pending Structured Patch Diffs */}
      {pendingPatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
            Pending Story Patches ({pendingPatches.length})
          </h3>
          {pendingPatches.map((patch) => {
            const isStale = patch.base_story_revision_id !== storyRevision.revision_id;
            return (
              <div key={patch.patch_id} className="kr-card rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-medium text-white">{patch.summary}</span>
                  </div>
                  {isStale && (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300">
                      Stale base · needs Rebase
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {patch.operations.map((op) => (
                    <div
                      key={op.op_id}
                      className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-[var(--kr-muted)]">
                        <span className="font-mono text-violet-300">{op.field_path}</span>
                        <span>{op.op}</span>
                      </div>
                      {op.before !== null && op.before !== undefined && (
                        <p className="mt-1.5 rounded bg-rose-500/10 px-2 py-1 text-rose-200 line-through">
                          {typeof op.before === "string" ? op.before : JSON.stringify(op.before)}
                        </p>
                      )}
                      <p className="mt-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-200">
                        {typeof op.after === "string"
                          ? op.after
                          : JSON.stringify(op.after).slice(0, 220)}
                      </p>
                      <p className="mt-1 text-[var(--kr-muted)]">{op.rationale}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!isStale ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handlePatchAction(patch.patch_id, "accept")}
                      className="kr-tap inline-flex items-center gap-1.5 rounded-xl bg-emerald-600/90 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <Check className="h-4 w-4" /> Accept
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handlePatchAction(patch.patch_id, "rebase")}
                      className="kr-tap inline-flex items-center gap-1.5 rounded-xl bg-amber-600/90 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500"
                    >
                      <RefreshCw className="h-4 w-4" /> Rebase to v{storyRevision.version}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePatchAction(patch.patch_id, "reject")}
                    className="kr-tap inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-[var(--kr-muted)] hover:text-white"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Scene Breakdown with Canon Locks */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
          Bilingual Scenes & Canon Guard
        </h3>
        {storyRevision.bible.scenes.map((scene, idx) => (
          <article key={scene.scene_id} className="kr-card rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--kr-muted)]">
                  <span className="font-mono text-violet-300">#{idx + 1}</span>
                  <span>{scene.chapter_title}</span>
                  <span>· {scene.target_duration_sec}s</span>
                </div>
                <h4 className="mt-1 text-base font-semibold text-white">{scene.title}</h4>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleToggleCanonLock(scene.scene_id, !scene.locked_canon)}
                className={`kr-tap inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
                  scene.locked_canon
                    ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
                    : "border-white/10 bg-white/5 text-[var(--kr-muted)]"
                }`}
              >
                {scene.locked_canon ? (
                  <>
                    <Lock className="h-3.5 w-3.5" /> Locked
                  </>
                ) : (
                  <>
                    <Unlock className="h-3.5 w-3.5" /> Editable
                  </>
                )}
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-black/30 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                  Hindi (HI)
                </div>
                <p className="mt-1 text-sm text-white">{scene.hi_narration}</p>
              </div>
              <div className="rounded-xl bg-black/30 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  English (EN)
                </div>
                <p className="mt-1 text-sm text-slate-200">{scene.en_narration}</p>
              </div>
            </div>

            <p className="mt-2.5 text-xs text-[var(--kr-muted)]">
              <span className="font-medium text-slate-300">Plate prompt:</span> {scene.visual_prompt}
            </p>
          </article>
        ))}
      </section>

      {/* Explicit Production Confirmation Modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Production Job"
        >
          <div className="kr-card w-full max-w-md rounded-2xl p-5">
            <div className="flex items-center gap-2 text-violet-300">
              <ShieldCheck className="h-5 w-5" />
              <h3 className="text-base font-semibold text-white">
                Confirm Zero-Spend Production
              </h3>
            </div>
            <p className="mt-2 text-sm text-[var(--kr-muted)]">
              Locks <strong className="text-white">Story v{storyRevision.version}</strong> and{" "}
              <strong className="text-white">Settings v{settingsRevision.version}</strong> into an
              idempotent <code className="text-violet-300">kr.job.v1</code> queue item.
            </p>
            <ul className="mt-3 space-y-1 rounded-xl bg-black/35 p-3 text-xs text-slate-300">
              <li>• Image baseline: FLUX.2 Klein 4B · 1344×768 · restrained-v1</li>
              <li>• HI voice: {settingsRevision.snapshot.voices.hi.voice_id}</li>
              <li>• EN voice: {settingsRevision.snapshot.voices.en.voice_id}</li>
              <li>• Policy: paid_routes=false (no billing fallback)</li>
            </ul>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="kr-tap rounded-xl border border-white/15 px-4 py-2.5 text-sm text-[var(--kr-muted)] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={handleConfirmProduction}
                className="kr-tap rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {confirmBusy ? "Queuing…" : "Confirm & Queue Job"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
