import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn, signOut } from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

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
 * Minimal signed-in identity chip + sign-out. Restyle freely (see the
 * `design-ui` skill). Sign-out is only shown when auth is enabled (the
 * disabled-auth dev user has nothing to sign out of) and the session is not
 * gate-materialized — behind the gate the next request signs the viewer
 * straight back in, so a sign-out control there is a broken loop.
 */
export function UserButton() {
  const user = useCurrentUser();
  // Sign-out can take a moment (and can fail when deployed), so the control
  // shows it is working and cannot be fired twice.
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateSessionOnServer,
  );
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? "Account";
  return (
    <div className="flex items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-medium">{label}</span>
      {authEnabled && !gateSession && (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            // Success navigates away; on failure re-enable so it can be retried.
            void signOut().catch(() => setSigningOut(false));
          }}
          className="cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      )}
    </div>
  );
}
