import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Clapperboard,
  Cpu,
  Download,
  FolderOpen,
  Link2,
  Settings,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { SignInButtons, SignInGate, UserButton } from "@/lib/auth/gates";
import { StudioDrawers } from "./Drawers";
import { EditorTab } from "./EditorTab";
import { ExportsTab } from "./ExportsTab";
import { ProductionTab } from "./ProductionTab";
import { StoryTab } from "./StoryTab";
import {
  krApiFetch,
  type PrimaryTab,
  type StudioDrawer,
  type WorkspaceSnapshot,
} from "./types";

const OFFLINE_DRAFT_KEY = "kr.offline.draft.v1";

export function KathaRiftStudioApp() {
  return (
    <SignInGate
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
          <div className="kr-card max-w-md rounded-2xl p-6">
            <h1 className="text-xl font-bold text-white">KathaRift Studio</h1>
            <p className="mt-2 text-sm text-[var(--kr-muted)]">
              Sign in to access your bilingual story canon, Colab production jobs, and timelines.
            </p>
            <div className="mt-5 flex justify-center">
              <SignInButtons />
            </div>
          </div>
        </div>
      }
    >
      <StudioShell />
    </SignInGate>
  );
}

function StudioShell() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PrimaryTab>("story");
  const [drawer, setDrawer] = useState<StudioDrawer>("none");
  const [draftInstruction, setDraftInstruction] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(OFFLINE_DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  // Offline draft persistence (non-secret story chat text only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (draftInstruction) window.localStorage.setItem(OFFLINE_DRAFT_KEY, draftInstruction);
      else window.localStorage.removeItem(OFFLINE_DRAFT_KEY);
    } catch {
      /* ignore storage failure */
    }
  }, [draftInstruction]);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await krApiFetch<WorkspaceSnapshot>("/api/kr/workspace");
      setWorkspace(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  return (
    <div className="min-h-screen bg-[var(--kr-bg-0)] text-[var(--kr-ink)]">
      {/* Compact Sticky Mobile-First Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--kr-bg-0)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-600/20 text-violet-300 ring-1 ring-violet-400/30">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold text-white sm:text-base">
                  KathaRift Studio
                </h1>
                <span className="hidden items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 sm:inline-flex">
                  <ShieldCheck className="h-3 w-3" /> $0 Zero-Spend
                </span>
              </div>
              {workspace && (
                <p className="truncate text-[11px] text-[var(--kr-muted)]">
                  Story v{workspace.storyRevision.version} · Timeline v{workspace.timeline.version}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {(
              [
                { id: "canon", icon: BookOpen, label: "Canon" },
                { id: "assets", icon: FolderOpen, label: "Assets" },
                { id: "connections", icon: Link2, label: "Connections" },
                { id: "activity", icon: Activity, label: "Activity" },
                { id: "settings", icon: Settings, label: "Settings" },
              ] as const
            ).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => setDrawer(id)}
                className="kr-tap grid place-items-center rounded-xl border border-white/10 bg-white/5 px-2.5 text-slate-200 hover:border-violet-400/40 hover:text-white"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <div className="hidden pl-1 sm:block">
              <UserButton />
            </div>
          </div>
        </div>
        {workspace?.runtime?.is_ephemeral_fixture && (
          <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200">
            LOCAL FIXTURE MODE · Ephemeral in-memory PGLite active (data resets on restart)
          </div>
        )}
        {isOffline && (
          <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200">
            <WifiOff className="h-3.5 w-3.5" /> Offline mode · local story draft preserved for
            recovery
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="screen-pad mx-auto max-w-4xl px-3 pt-4 sm:px-5">
        {loading ? (
          <div className="kr-card rounded-2xl p-8 text-center text-sm text-[var(--kr-muted)]">
            Loading KathaRift Studio workspace…
          </div>
        ) : loadError || !workspace ? (
          <div className="kr-card rounded-2xl border border-amber-400/25 p-6 text-center">
            <p className="text-sm font-semibold text-rose-300">
              {loadError ?? "Workspace unavailable"}
            </p>
            <p className="mt-2 text-xs text-[var(--kr-muted)]">
              Preview/production requires durable PostgreSQL (<code>DATABASE_URL</code>) and
              server auth secrets (<code>BETTER_AUTH_SECRET</code>,{" "}
              <code>GROK_AUTH_CLIENT_ID</code>, <code>GROK_AUTH_CLIENT_SECRET</code>). Server auth
              fails closed and is never bypassed by frontend flags.
            </p>
            <button
              type="button"
              onClick={() => void refreshWorkspace()}
              className="kr-tap mt-3 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {activeTab === "story" && (
              <StoryTab
                workspace={workspace}
                draftInstruction={draftInstruction}
                onDraftInstructionChange={setDraftInstruction}
                onRefresh={refreshWorkspace}
                onNavigateProduction={() => setActiveTab("production")}
              />
            )}
            {activeTab === "production" && (
              <ProductionTab workspace={workspace} onRefresh={refreshWorkspace} />
            )}
            {activeTab === "editor" && (
              <EditorTab workspace={workspace} onRefresh={refreshWorkspace} />
            )}
            {activeTab === "exports" && (
              <ExportsTab workspace={workspace} onRefresh={refreshWorkspace} />
            )}
          </>
        )}
      </main>

      {/* Phone-First 4-Tab Bottom Navigation Dock */}
      <nav
        aria-label="Primary studio tabs"
        className="dock-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[var(--kr-bg-1)]/95 backdrop-blur-md"
      >
        <div className="mx-auto grid max-w-4xl grid-cols-4 gap-1 px-2 py-1.5">
          {(
            [
              { id: "story", label: "Story", icon: Sparkles },
              { id: "production", label: "Production", icon: Cpu },
              { id: "editor", label: "Editor", icon: Clapperboard },
              { id: "exports", label: "Exports", icon: Download },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`kr-tap flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition ${
                  active
                    ? "bg-violet-600/20 text-violet-200 ring-1 ring-violet-400/35"
                    : "text-[var(--kr-muted)] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Side Drawers */}
      {workspace && (
        <StudioDrawers
          drawer={drawer}
          workspace={workspace}
          onClose={() => setDrawer("none")}
          onRefresh={refreshWorkspace}
        />
      )}
    </div>
  );
}
