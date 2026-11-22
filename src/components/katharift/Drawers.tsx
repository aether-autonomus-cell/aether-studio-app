import { useState } from "react";
import { ShieldAlert, ShieldCheck, Wrench, X } from "lucide-react";
import { FREE_ROUTE_ALLOWLIST, type FreeRouteId } from "@/packages/contracts/schemas";
import { krApiFetch, type StudioDrawer, type WorkspaceSnapshot } from "./types";

interface DrawersProps {
  drawer: StudioDrawer;
  workspace: WorkspaceSnapshot;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

const STATUS_BADGE: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-300",
  waiting_worker: "bg-amber-500/15 text-amber-300",
  blocked_licence: "bg-rose-500/20 text-rose-200",
  unavailable_incompatible: "bg-slate-500/20 text-slate-300",
  dev_only_not_production: "bg-slate-500/20 text-slate-400",
  broken: "bg-rose-600/30 text-rose-100",
};

export function StudioDrawers({ drawer, workspace, onClose, onRefresh }: DrawersProps) {
  const [route, setRoute] = useState<FreeRouteId>(
    workspace.settingsRevision.snapshot.director_route,
  );
  const [hiVoice, setHiVoice] = useState(workspace.settingsRevision.snapshot.voices.hi.voice_id);
  const [enVoice, setEnVoice] = useState(workspace.settingsRevision.snapshot.voices.en.voice_id);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toolResult, setToolResult] = useState<string | null>(null);

  const [connProvider, setConnProvider] = useState<
    "google_drive" | "google_gemini_free" | "groq_free" | "openrouter_free"
  >("google_drive");
  const [connLabel, setConnLabel] = useState("KathaRift-Studio Drive");
  const [connSecret, setConnSecret] = useState("");
  const [connMsg, setConnMsg] = useState<string | null>(null);

  if (drawer === "none") return null;

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await krApiFetch("/api/kr/settings", {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          snapshot: {
            director_route: route,
            voices: {
              hi: { ...workspace.settingsRevision.snapshot.voices.hi, voice_id: hiVoice },
              en: { ...workspace.settingsRevision.snapshot.voices.en, voice_id: enVoice },
            },
          },
        }),
      });
      await onRefresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function testSkillTool(toolName: "youtube_score_hooks" | "lemo_style_docs_lookup") {
    const args =
      toolName === "youtube_score_hooks"
        ? { hook: "You lost 3 hours before noticing the stepwell carved under Chand Baori?" }
        : { query: "anime lighting" };
    const res = await krApiFetch<{ ok: boolean; data: unknown; error: string | null }>(
      "/api/kr/skills/run",
      {
        method: "POST",
        body: JSON.stringify({
          project_id: workspace.project.project_id,
          mode: "tool",
          tool_name: toolName,
          args,
        }),
      },
    );
    setToolResult(JSON.stringify(res, null, 2));
    await onRefresh();
  }

  async function handleSaveConnection(e: React.FormEvent) {
    e.preventDefault();
    setConnMsg(null);
    const res = await krApiFetch<{ provider: string; status: string }>("/api/kr/connections", {
      method: "POST",
      body: JSON.stringify({
        provider: connProvider,
        account_label: connLabel,
        secret: connSecret || undefined,
      }),
    });
    setConnSecret("");
    setConnMsg(`Saved ${res.provider} (${res.status})`);
    await onRefresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-label={`${drawer} drawer`}
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[var(--kr-bg-1)]">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-base font-semibold capitalize text-white">
            {drawer === "settings" ? "Settings & Skills" : drawer}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="kr-tap grid place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {drawer === "settings" && (
            <>
              {/* Zero-Spend & Baseline Settings */}
              <div className="kr-card rounded-2xl p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    Zero-Spend Lock Active (paid_routes=false)
                  </span>
                </div>

                <div className="mt-3 space-y-3 text-xs">
                  <label className="block">
                    <span className="text-[var(--kr-muted)]">Director Free Route</span>
                    <select
                      value={route}
                      onChange={(e) => setRoute(e.target.value as FreeRouteId)}
                      className="kr-input kr-tap mt-1 w-full rounded-xl px-3 py-2 text-sm"
                    >
                      {FREE_ROUTE_ALLOWLIST.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[var(--kr-muted)]">Hindi Voice (HI)</span>
                      <select
                        value={hiVoice}
                        onChange={(e) => setHiVoice(e.target.value)}
                        className="kr-input kr-tap mt-1 w-full rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="hi-IN-SwaraNeural">hi-IN-SwaraNeural (Edge Free)</option>
                        <option value="hi-IN-MadhurNeural">hi-IN-MadhurNeural (Edge Free)</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[var(--kr-muted)]">English Voice (EN)</span>
                      <select
                        value={enVoice}
                        onChange={(e) => setEnVoice(e.target.value)}
                        className="kr-input kr-tap mt-1 w-full rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="en-IN-NeerjaNeural">en-IN-NeerjaNeural (Edge Free)</option>
                        <option value="en-IN-PrabhatNeural">en-IN-PrabhatNeural (Edge Free)</option>
                      </select>
                    </label>
                  </div>

                  <div className="rounded-xl bg-black/35 p-3 text-[11px] text-slate-300">
                    Locked Image Baseline: <strong>FLUX.2 Klein 4B</strong> (rev{" "}
                    <code>e7b7dc27</code>) + Qwen3 NF4/FP32 @ 1344×768 ·{" "}
                    <code>restrained-v1</code>
                  </div>

                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={saveSettings}
                    className="kr-tap w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
                  >
                    {savingSettings ? "Saving Settings Revision…" : "Save Settings Revision"}
                  </button>
                </div>
              </div>

              {/* Section 33 Skills & Tools Status Panel */}
              <div className="kr-card rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Wrench className="h-4 w-4 text-violet-400" />
                    Skills & Tools (Section 33)
                  </h3>
                  <span className="text-[11px] text-[var(--kr-muted)]">
                    {workspace.skillsReport.summary.ready} ready ·{" "}
                    {workspace.skillsReport.summary.waiting_worker} worker ·{" "}
                    {workspace.skillsReport.summary.blocked_licence} blocked
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => testSkillTool("youtube_score_hooks")}
                    className="kr-tap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white hover:bg-white/10"
                  >
                    Test Hook Scorer (MIT)
                  </button>
                  <button
                    type="button"
                    onClick={() => testSkillTool("lemo_style_docs_lookup")}
                    className="kr-tap inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/20"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> Test CC-BY-NC Gate
                  </button>
                </div>

                {toolResult && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-black/50 p-2.5 text-[11px] text-slate-200">
                    {toolResult}
                  </pre>
                )}

                <div className="mt-3 space-y-2">
                  {workspace.skillsReport.skills.map((skill) => (
                    <div
                      key={skill.skill_id}
                      className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">{skill.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            STATUS_BADGE[skill.status] ?? "bg-white/10 text-white"
                          }`}
                        >
                          {skill.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--kr-muted)]">
                        <span>{skill.spdx_license}</span>
                        <span>· {skill.runtime}</span>
                        <span>· {skill.verified_files}/{skill.total_files} verified</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{skill.notes}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {drawer === "canon" && (
            <div className="space-y-3">
              <div className="kr-card rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-white">Style Bible</h3>
                <p className="mt-1 text-xs text-slate-300">
                  {workspace.storyRevision.bible.style_bible}
                </p>
              </div>
              {workspace.storyRevision.bible.characters.map((ch) => (
                <div key={ch.id} className="kr-card rounded-2xl p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{ch.name}</span>
                    <span className="text-violet-300">{ch.role}</span>
                  </div>
                  <p className="mt-1.5 text-slate-300">{ch.visual_bible}</p>
                  <p className="mt-1 text-[var(--kr-muted)]">
                    HI: {ch.hi_voice_profile} · EN: {ch.en_voice_profile}
                  </p>
                </div>
              ))}
            </div>
          )}

          {drawer === "assets" && (
            <div className="space-y-2.5">
              {workspace.timeline.clips.map((clip) => (
                <div key={clip.clip_id} className="kr-card rounded-2xl p-4 text-xs">
                  <div className="font-semibold text-white">{clip.label}</div>
                  <div className="mt-1 text-[var(--kr-muted)]">
                    Frames [{clip.in_frame}, {clip.out_frame}) · HI {clip.hi_audio_samples} samples · EN{" "}
                    {clip.en_audio_samples} samples
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-violet-300">
                    Drive Plate: {clip.drive_image_id ?? "Pending Colab worker render"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {drawer === "connections" && (
            <div className="space-y-4">
              <form onSubmit={handleSaveConnection} className="kr-card space-y-3 rounded-2xl p-4 text-xs">
                <h3 className="text-sm font-semibold text-white">
                  Connect Storage / Free-Tier Provider
                </h3>
                <p className="text-[var(--kr-muted)]">
                  Secrets are stored server-side only (never bundled in client JS or localStorage).
                </p>
                <select
                  value={connProvider}
                  onChange={(e) => setConnProvider(e.target.value as typeof connProvider)}
                  className="kr-input kr-tap w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="google_drive">Google Drive (KathaRift-Studio)</option>
                  <option value="google_gemini_free">Google Gemini Free Tier</option>
                  <option value="groq_free">Groq Free Tier</option>
                  <option value="openrouter_free">OpenRouter Free Tier</option>
                </select>
                <input
                  type="text"
                  value={connLabel}
                  onChange={(e) => setConnLabel(e.target.value)}
                  placeholder="Account / folder label"
                  className="kr-input kr-tap w-full rounded-xl px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  value={connSecret}
                  onChange={(e) => setConnSecret(e.target.value)}
                  placeholder="Paste free-tier key or OAuth refresh token (optional)"
                  className="kr-input kr-tap w-full rounded-xl px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="kr-tap w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
                >
                  Save Connection
                </button>
                {connMsg && <p className="text-emerald-300">{connMsg}</p>}
              </form>

              <div className="space-y-2">
                {workspace.connections.length === 0 ? (
                  <p className="text-xs text-[var(--kr-muted)]">
                    No connections configured yet (honest disconnected state).
                  </p>
                ) : (
                  workspace.connections.map((c) => (
                    <div key={c.connection_id} className="kr-card rounded-2xl p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{c.provider}</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">
                          {c.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[var(--kr-muted)]">
                        {c.account_label} · {c.secret_preview ?? "no secret"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {drawer === "activity" && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--kr-muted)]">
                Sanitized Skill Invocation Traces ({workspace.skillTraces.length})
              </h3>
              {workspace.skillTraces.length === 0 ? (
                <p className="text-xs text-[var(--kr-muted)]">No skill tool invocations logged yet.</p>
              ) : (
                workspace.skillTraces.map((tr) => (
                  <div key={tr.trace_id} className="kr-card rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-violet-300">{tr.tool_name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          tr.status === "ok"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-200"
                        }`}
                      >
                        {tr.status} · {tr.duration_ms}ms
                      </span>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto text-[10px] text-slate-300">
                      {JSON.stringify(tr.output_summary)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
