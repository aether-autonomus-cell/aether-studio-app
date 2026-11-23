import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Mail, ShieldCheck } from "lucide-react";
import { GROK_PROVIDERS, authEnabled, signIn, signOut } from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";
import { buildUserProfileDisplay } from "./user-profile-display";

const subscribeToNothing = () => () => {};
const noGateSessionOnServer = () => false;

/**
 * Auth state components — plain wrappers around `useCurrentUserState()`.
 *
 * With auth on, visitors are signed out until they authenticate — in the sandbox
 * live preview too, which does real sign-in. The shared dev user appears only
 * when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
 * While the session is still resolving, gates that care about signed-out state
 * render nothing so there's no signed-out flash on hard reload.
 */

/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
export const SIGN_IN_PATH = "/login";

/** Render children only when a user is present (real session, or the disabled-auth dev user). */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/**
 * Render children only once we KNOW the visitor is signed out (`isPending` has
 * cleared and there is no user). Hidden while the session is still loading.
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

/**
 * Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
 * `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
 * session loading, which feels like a second "Loading…" on /login.
 *
 * Guard routes by waiting out `isPending` first (see `use-current-user`), then
 * render this.
 */
export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({ isPending, hasUser: user !== null });
  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;
  return <>{fallback ?? <SignInButtons />}</>;
}

type SignInProviderOption = {
  providerId: string;
  label: string;
  flow: "social" | "oauth2";
};

type AuthStatusPayload = {
  ready: boolean;
  code: string | null;
  message: string;
  providers: SignInProviderOption[];
};

function readUrlAuthError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("auth_error") ?? params.get("error");
  if (!code) return null;
  if (code === "OWNER_FORBIDDEN" || code === "access_denied" || code === "unable_to_create_user") {
    return "Access is restricted to the verified studio owner Google account.";
  }
  return `Sign-in blocked (${code}).`;
}

export function SignInButtons() {
  const [status, setStatus] = useState<AuthStatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(() => readUrlAuthError());

  useEffect(() => {
    let active = true;
    fetch("/api/kr/auth-status", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as AuthStatusPayload;
      })
      .then((payload) => {
        if (active && payload) setStatus(payload);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const providers: SignInProviderOption[] =
    status?.providers ??
    GROK_PROVIDERS.map((p) => ({
      providerId: p.providerId,
      label: p.label,
      flow: "oauth2" as const,
    }));

  if (statusLoading) {
    return (
      <div className="w-full max-w-sm rounded-md border border-white/10 px-4 py-2 text-xs text-[var(--kr-muted)]">
        Checking authentication status…
      </div>
    );
  }

  if (status && !status.ready) {
    return (
      <div className="w-full max-w-sm rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-left text-xs text-amber-200">
        <p className="font-semibold text-amber-100">
          {status.code ?? "AUTH_NOT_CONFIGURED"}
        </p>
        <p className="mt-1 text-amber-200/90">{status.message}</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      {actionError && (
        <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {actionError}
        </div>
      )}
      {providers.map((p) => (
        <button
          key={p.providerId}
          type="button"
          disabled={busyProvider !== null}
          onClick={() => {
            setActionError(null);
            setBusyProvider(p.providerId);
            void signIn(p.providerId, {
              flow: p.flow,
              callbackURL: "/",
              errorCallbackURL: "/?auth_error=access_denied",
            }).catch((err) => {
              setBusyProvider(null);
              setActionError(err instanceof Error ? err.message : "Sign-in failed");
            });
          }}
          className="w-full cursor-pointer rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100 disabled:cursor-wait disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {busyProvider === p.providerId ? `Redirecting to ${p.label}…` : `Continue with ${p.label}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Responsive signed-in profile chip + accessible menu (mobile & desktop).
 * Preserves existing session logic: sign-out is only shown when auth is enabled
 * and the session is not gate-materialized.
 */
export function UserButton() {
  const user = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateSessionOnServer,
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  const profile = buildUserProfileDisplay(user, { authEnabled, gateSession });

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Owner account menu (${profile.secondaryEmail ?? profile.displayLabel})`}
        onClick={() => setMenuOpen((prev) => !prev)}
        className="kr-tap inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-2 py-1.5 text-left text-slate-100 hover:border-violet-400/40 hover:bg-white/10"
      >
        {user.profileImageUrl ? (
          <img
            src={user.profileImageUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-white/20"
          />
        ) : (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-600/35 text-xs font-semibold text-violet-100 ring-1 ring-violet-400/40">
            {profile.initial}
          </span>
        )}
        <span className="hidden max-w-[112px] truncate text-xs font-medium sm:inline">
          {profile.displayLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--kr-muted)]" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Account details"
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-[#121826] p-3.5 shadow-2xl ring-1 ring-black/60"
        >
          <div className="flex items-start gap-2.5 border-b border-white/10 pb-3">
            {user.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
              />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-600/35 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/40">
                {profile.initial}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                {profile.displayLabel}
              </div>
              {profile.secondaryEmail && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-300">
                  <Mail className="h-3 w-3 shrink-0 text-violet-300" />
                  <span className="break-all">{profile.secondaryEmail}</span>
                </div>
              )}
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                {profile.sessionNote}
              </div>
            </div>
          </div>

          <div className="mt-3">
            {profile.canSignOut ? (
              <button
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  void signOut().catch(() => setSigningOut(false));
                }}
                className="kr-tap flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/15 px-3 py-2.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/25 disabled:cursor-wait disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            ) : (
              <p className="text-[11px] text-[var(--kr-muted)]">
                Sign-out is disabled for this session mode.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
