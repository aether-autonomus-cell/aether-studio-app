import { isPreviewOrProductionEnv } from "../../lib/db-policy.ts";

export class AuthConfigurationError extends Error {
  readonly status = 401;
  readonly code = "AUTH_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export class OwnerForbiddenError extends Error {
  readonly status = 403;
  readonly code = "OWNER_FORBIDDEN";

  constructor(message = "Access restricted to the verified studio owner.") {
    super(message);
    this.name = "OwnerForbiddenError";
  }
}

export type ServerAuthPolicy =
  | {
      configured: true;
      hasGoogleOAuth: boolean;
      hasOAuthClient: boolean;
      hasGateIdentity: boolean;
      ownerEmails: string[];
    }
  | {
      configured: false;
      code: "AUTH_NOT_CONFIGURED";
      reason: string;
    };

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * Parse the server-side owner-only email allowlist (`KR_OWNER_EMAIL` /
 * `KR_ALLOWED_EMAILS`). Entries are normalized to lowercase and deduplicated.
 */
export function parseOwnerEmailAllowlist(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string[] {
  const raw = [trimmed(env.KR_OWNER_EMAIL), trimmed(env.KR_ALLOWED_EMAILS)]
    .filter(Boolean)
    .join(",");
  if (!raw) return [];
  const emails = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const normalized = part.trim().toLowerCase();
    if (normalized && normalized.includes("@")) {
      emails.add(normalized);
    }
  }
  return [...emails];
}

export function isOwnerEmailAllowed(
  email: string | null | undefined,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!email) return false;
  const allowlist = parseOwnerEmailAllowlist(env);
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * Verify a caller's identity against the server-side owner allowlist and
 * email-verification status. Never trusts client flags or UI-only checks.
 */
export function assertVerifiedOwnerIdentity(
  identity: {
    email?: string | null;
    emailVerified?: boolean | null;
    linkedProviders?: readonly string[] | null;
  },
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
  opts?: {
    requireAllowlist?: boolean;
    requireGoogleProvider?: boolean;
  },
): void {
  const allowlist = parseOwnerEmailAllowlist(env);
  const enforceAllowlist = Boolean(opts?.requireAllowlist) || allowlist.length > 0;
  if (!enforceAllowlist) return;

  if (allowlist.length === 0) {
    throw new AuthConfigurationError(
      "Server authentication is not configured: KR_OWNER_EMAIL allowlist is missing (fail-closed).",
    );
  }

  const email = identity.email?.trim().toLowerCase();
  if (!email) {
    throw new OwnerForbiddenError("Verified owner email is missing from session.");
  }

  if (identity.emailVerified !== true) {
    throw new OwnerForbiddenError("Email address must be verified by the identity provider.");
  }

  if (!allowlist.includes(email)) {
    throw new OwnerForbiddenError("Access denied: account is not in the server owner allowlist.");
  }

  if (opts?.requireGoogleProvider && identity.linkedProviders) {
    const hasGoogle = identity.linkedProviders.some(
      (provider) => provider === "google" || provider === "grok-google",
    );
    if (!hasGoogle) {
      throw new OwnerForbiddenError("Verified Google account linkage is required.");
    }
  }
}

/**
 * Evaluate server authentication readiness.
 *
 * CRITICAL SECURITY INVARIANT:
 * `VITE_AUTH_ENABLED` is a client/build UI flag and is NEVER consulted here.
 * Setting `VITE_AUTH_ENABLED=false` cannot disable or bypass server-side auth.
 * Missing server secrets or owner allowlist (for Google OAuth) always fail closed.
 */
export function resolveServerAuthPolicy(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ServerAuthPolicy {
  const betterAuthSecret = trimmed(env.BETTER_AUTH_SECRET);
  if (!betterAuthSecret || betterAuthSecret.length < 16) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured: BETTER_AUTH_SECRET is missing or shorter than 16 characters " +
        "(fail-closed; VITE_AUTH_ENABLED cannot bypass server auth).",
    };
  }

  const hasGoogleOAuth = Boolean(
    trimmed(env.GOOGLE_CLIENT_ID) && trimmed(env.GOOGLE_CLIENT_SECRET),
  );
  const hasOAuthClient = Boolean(
    trimmed(env.GROK_AUTH_CLIENT_ID) && trimmed(env.GROK_AUTH_CLIENT_SECRET),
  );
  const hasGateIdentity = Boolean(
    trimmed(env.GROK_GATE_ORIGIN) || trimmed(env.GROK_PROJECT_ID),
  );
  const ownerEmails = parseOwnerEmailAllowlist(env);

  if (!hasGoogleOAuth && !hasOAuthClient && !hasGateIdentity) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, " +
        "GROK_AUTH_CLIENT_ID/GROK_AUTH_CLIENT_SECRET, or Grok gate identity env are missing (fail-closed).",
    };
  }

  if (hasGoogleOAuth && ownerEmails.length === 0) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured: KR_OWNER_EMAIL (verified owner-only allowlist) " +
        "is required when Google OAuth is enabled (fail-closed).",
    };
  }

  if (
    isPreviewOrProductionEnv(env) &&
    !hasGoogleOAuth &&
    !hasOAuthClient &&
    !trimmed(env.GROK_PROJECT_ID)
  ) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured for preview/production: " +
        "explicit Google/Grok OAuth client credentials or GROK_PROJECT_ID are required.",
    };
  }

  return {
    configured: true,
    hasGoogleOAuth,
    hasOAuthClient,
    hasGateIdentity,
    ownerEmails,
  };
}
