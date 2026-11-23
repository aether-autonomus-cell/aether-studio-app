import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "../db";
import {
  assertVerifiedOwnerIdentity,
  AuthConfigurationError,
  OwnerForbiddenError,
  resolveServerAuthPolicy,
} from "../../server/katharift/auth-policy";
import { auth, authConfigured } from "./server";

export { authConfigured, AuthConfigurationError, OwnerForbiddenError };

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries
 * `status: 401`.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
};

/**
 * Resolve the signed-in user from the current request, or `null` when server
 * auth secrets are missing or nobody is signed in.
 */
export async function getSessionUser(
  bearerToken?: string,
): Promise<VerifiedUser | null> {
  const policy = resolveServerAuthPolicy(process.env);
  if (!policy.configured) return null;
  const request = getRequest();
  if (!request) return null;
  let headers = request.headers;
  if (bearerToken) {
    headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    emailVerified: Boolean(session.user.emailVerified),
  };
}

/**
 * Fail-closed server user resolution + verified owner-allowlist check.
 *
 * - Missing server auth secrets / allowlist -> throws `AuthConfigurationError` (401).
 * - Missing / invalid session -> throws `UnauthorizedError` (401).
 * - Unverified email, non-owner email, or missing Google account linkage -> throws `OwnerForbiddenError` (403).
 * - `VITE_AUTH_ENABLED` is NEVER consulted and can never bypass authentication.
 */
export async function requireUserId(bearerToken?: string): Promise<string> {
  const policy = resolveServerAuthPolicy(process.env);
  if (!policy.configured) {
    throw new AuthConfigurationError(policy.reason);
  }
  const user = await getSessionUser(bearerToken);
  if (!user) throw new UnauthorizedError();

  let linkedProviders: string[] | null = null;
  if (policy.hasGoogleOAuth) {
    const sql = await getSql();
    const rows = await sql<{ providerId: string }>`
      SELECT "providerId"
      FROM "account"
      WHERE "userId" = ${user.id}
    `;
    linkedProviders = rows.map((row) => row.providerId);
  }

  assertVerifiedOwnerIdentity(
    {
      email: user.email,
      emailVerified: user.emailVerified,
      linkedProviders,
    },
    process.env,
    {
      requireAllowlist: policy.hasGoogleOAuth,
      requireGoogleProvider: policy.hasGoogleOAuth,
    },
  );

  return user.id;
}
