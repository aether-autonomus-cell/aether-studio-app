import { isPreviewOrProductionEnv } from "../../lib/db-policy.ts";

export class AuthConfigurationError extends Error {
  readonly status = 401;
  readonly code = "AUTH_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export type ServerAuthPolicy =
  | {
      configured: true;
      hasOAuthClient: boolean;
      hasGateIdentity: boolean;
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
 * Evaluate server authentication readiness.
 *
 * CRITICAL SECURITY INVARIANT:
 * `VITE_AUTH_ENABLED` is a client/build UI flag and is NEVER consulted here.
 * Setting `VITE_AUTH_ENABLED=false` cannot disable or bypass server-side auth.
 * Missing server secrets always fail closed.
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

  const hasOAuthClient = Boolean(
    trimmed(env.GROK_AUTH_CLIENT_ID) && trimmed(env.GROK_AUTH_CLIENT_SECRET),
  );
  const hasGateIdentity = Boolean(
    trimmed(env.GROK_GATE_ORIGIN) || trimmed(env.GROK_PROJECT_ID),
  );

  if (!hasOAuthClient && !hasGateIdentity) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured: GROK_AUTH_CLIENT_ID/GROK_AUTH_CLIENT_SECRET " +
        "(or Grok gate identity env) are missing (fail-closed).",
    };
  }

  if (isPreviewOrProductionEnv(env) && !hasOAuthClient && !trimmed(env.GROK_PROJECT_ID)) {
    return {
      configured: false,
      code: "AUTH_NOT_CONFIGURED",
      reason:
        "Server authentication is not configured for preview/production: " +
        "explicit OAuth client credentials or GROK_PROJECT_ID are required.",
    };
  }

  return {
    configured: true,
    hasOAuthClient,
    hasGateIdentity,
  };
}
