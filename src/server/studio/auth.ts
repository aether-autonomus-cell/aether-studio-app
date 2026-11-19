import { env } from "@/lib/env.server";
import { getSessionUser } from "@/lib/auth/verify.server";

export interface OwnerIdentity {
  authenticated: boolean;
  ownerSub: string;
  email: string | null;
}

export function isCloudDatabaseConfigured(): boolean {
  return Boolean(env("DATABASE_URL"));
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    env("GOOGLE_CLIENT_ID") &&
      env("GOOGLE_CLIENT_SECRET") &&
      env("AETHER_TOKEN_ENCRYPTION_KEY"),
  );
}

/**
 * Verifies owner identity when OIDC/Better Auth is configured.
 * Checks optional AETHER_OWNER_EMAIL allowlist when set.
 */
export async function requireOwnerIdentity(request: Request): Promise<OwnerIdentity> {
  const ownerToken = env("AETHER_OWNER_TOKEN");
  const authHeader = request.headers.get("authorization") ?? "";
  if (ownerToken && authHeader === `Bearer ${ownerToken}`) {
    return { authenticated: true, ownerSub: "owner-token", email: null };
  }

  const ownerEmailAllowlist = env("AETHER_OWNER_EMAIL")?.toLowerCase();
  try {
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
    const user = await getSessionUser(bearer);
    if (user?.id) {
      if (
        ownerEmailAllowlist &&
        user.email &&
        user.email.toLowerCase() !== ownerEmailAllowlist
      ) {
        return { authenticated: false, ownerSub: "", email: user.email };
      }
      return {
        authenticated: true,
        ownerSub: user.id,
        email: user.email ?? null,
      };
    }
  } catch {
    /* ignore when session context is unavailable */
  }

  // When auth is explicitly disabled in local preview without DATABASE_URL
  if (env("VITE_AUTH_ENABLED") === "false" && !isCloudDatabaseConfigured()) {
    return { authenticated: true, ownerSub: "owner-local", email: null };
  }
  return { authenticated: false, ownerSub: "", email: null };
}

export function checkSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}
