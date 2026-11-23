import type { AppUser } from "./use-current-user.ts";

export interface UserProfileDisplay {
  displayLabel: string;
  secondaryEmail: string | null;
  initial: string;
  canSignOut: boolean;
  sessionNote: string;
}

export function buildUserProfileDisplay(
  user: Pick<AppUser, "displayName" | "primaryEmail" | "isDevFallback">,
  opts: { authEnabled: boolean; gateSession: boolean },
): UserProfileDisplay {
  const displayLabel = user.displayName?.trim() || user.primaryEmail?.trim() || "Account";
  const secondaryEmail = user.primaryEmail?.trim() || null;
  const initial = displayLabel.charAt(0).toUpperCase() || "A";
  const canSignOut = opts.authEnabled && !opts.gateSession;
  const sessionNote = canSignOut
    ? "Verified Google owner session"
    : opts.gateSession
      ? "Preview gate session"
      : "Local dev session (auth disabled)";

  return {
    displayLabel,
    secondaryEmail,
    initial,
    canSignOut,
    sessionNote,
  };
}
