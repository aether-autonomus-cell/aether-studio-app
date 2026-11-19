import { useEffect, useState } from "react";
import {
  BookOpen,
  Code2,
  Cpu,
  History,
  Send,
  Sparkles,
} from "lucide-react";
import { fetchStudioStatus, type StudioStatusResponse } from "@/lib/studio/api";
import {
  listProjectRevisions,
  loadActiveProject,
  saveProjectSnapshot,
  type ProjectRevisionEntry,
} from "@/lib/studio/persist";
import { createDefaultProject, type SceneGraphV1 } from "@/lib/studio/schema";
import { CodePreviewTab } from "./code-preview-tab";
import { ColabRenderTab } from "./colab-render-tab";
import { DirectPublishTab } from "./direct-publish-tab";
import { StoryTab } from "./story-tab";

type StudioTabId = "story" | "code-preview" | "colab-render" | "direct-publish";

const TABS: {
  id: StudioTabId;
  label: string;
  shortLabel: string;
  icon: typeof BookOpen;
}[] = [
  { id: "story", label: "Story", shortLabel: "Story", icon: BookOpen },
  {
    id: "code-preview",
    label: "2D Code & Live Preview",
    shortLabel: "2D Preview",
    icon: Code2,
  },
  { id: "colab-render", label: "Colab Render", shortLabel: "Colab", icon: Cpu },
  { id: "direct-publish", label: "Direct Publish", shortLabel: "Publish", icon: Send },
];

export function StudioApp() {
  const [activeTab, setActiveTab] = useState<StudioTabId>("story");
  const [job, setJob] = useState<SceneGraphV1>(() => createDefaultProject());
  const [status, setStatus] = useState<StudioStatusResponse>({
    mode: "local-ready",
    keyless_ai: true,
    oauth_configured: false,
    database_configured: false,
    owner_authenticated: false,
  });
  const [revisions, setRevisions] = useState<ProjectRevisionEntry[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadActiveProject().then((loaded) => {
      if (!mounted) return;
      setJob(loaded);
      void listProjectRevisions(loaded.project_id).then((revs) => {
        if (mounted) setRevisions(revs);
      });
    });
    void fetchStudioStatus().then((st) => {
      if (mounted) setStatus(st);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateJob = (
    next: SceneGraphV1,
    note = "Autosave",
    recordRevision = false,
  ) => {
    setJob(next);
    void saveProjectSnapshot(next, note, recordRevision).then(() => {
      if (recordRevision) {
        void listProjectRevisions(next.project_id).then(setRevisions);
      }
    });
  };

  const handleCompileAndOpenPreview = (next: SceneGraphV1) => {
    const bumped: SceneGraphV1 = {
      ...next,
      project_revision: next.project_revision + 1,
    };
    handleUpdateJob(bumped, "Compiled to 2D SceneGraphV1", true);
    setActiveTab("code-preview");
  };

  return (
    <div className="min-h-screen bg-[#070B16] text-[#F5F7FF]">
      {/* Top Studio Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#070B16]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#5DE6FF] to-[#A78BFA] text-slate-950 shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  Aether Studio
                </h1>
                <span className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-200">
                  v2.0
                </span>
              </div>
              <p className="hidden text-[11px] text-slate-400 sm:block">
                Pure 2D Code-to-Video · Dual-Language HI + EN
              </p>
            </div>
          </div>

          {/* Desktop 4-Tab Navigation */}
          <nav
            aria-label="Primary studio tabs"
            className="hidden items-center gap-1 rounded-xl border border-slate-800 bg-[#111A2E]/90 p-1 md:flex"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-gradient-to-r from-[#5DE6FF] to-[#A78BFA] text-slate-950 shadow"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Revision & Mode Badge */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRevisions((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-cyan-400/60"
            >
              <History className="h-3.5 w-3.5 text-cyan-300" />
              <span className="font-mono">r{job.project_revision}</span>
            </button>
            <span className="hidden rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 sm:inline-flex">
              {status.mode === "cloud-ready" ? "Cloud Ready" : "Zero-Setup Ready"}
            </span>
          </div>
        </div>

        {/* Revision Drawer */}
        {showRevisions && (
          <div className="border-t border-slate-800 bg-[#0B1222] px-4 py-3">
            <div className="mx-auto max-w-7xl">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  IndexedDB Saved Revisions ({revisions.length})
                </span>
                <button
                  type="button"
                  onClick={() => setShowRevisions(false)}
                  className="text-cyan-300 hover:underline"
                >
                  Close
                </button>
              </div>
              {revisions.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No manual revisions frozen yet. Click Compile to 2D Code to record one.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {revisions.map((rev) => (
                    <button
                      key={rev.revision_id}
                      type="button"
                      onClick={() => {
                        setJob(rev.snapshot);
                        setShowRevisions(false);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-left text-[11px] text-slate-200 hover:border-cyan-400"
                    >
                      <span className="font-mono font-bold text-cyan-300">
                        r{rev.project_revision}
                      </span>{" "}
                      · {rev.note}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Active Tab Content */}
      <main className="screen-pad mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        {activeTab === "story" && (
          <StoryTab
            job={job}
            onUpdateJob={handleUpdateJob}
            onCompileAndOpenPreview={handleCompileAndOpenPreview}
          />
        )}
        {activeTab === "code-preview" && (
          <CodePreviewTab job={job} onUpdateJob={handleUpdateJob} />
        )}
        {activeTab === "colab-render" && (
          <ColabRenderTab job={job} status={status} onUpdateJob={handleUpdateJob} />
        )}
        {activeTab === "direct-publish" && (
          <DirectPublishTab job={job} status={status} onUpdateJob={handleUpdateJob} />
        )}
      </main>

      {/* Mobile Bottom 4-Tab Bar */}
      <nav
        aria-label="Mobile studio navigation"
        className="dock-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-800 bg-[#070B16]/95 backdrop-blur-md md:hidden"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                active ? "text-[#5DE6FF]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
