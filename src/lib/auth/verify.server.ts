import { getRequest } from "@tanstack/react-start/server";
import {
  AuthConfigurationError,
  resolveServerAuthPolicy,
} from "../../server/katharift/auth-policy";
import { auth, authConfigured } from "./server";

export { authConfigured, AuthConfigurationError };

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

export type VerifiedUser = { id: string; email: string | null };

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
  return { id: session.user.id, email: session.user.email ?? null };
}

/**
 * Fail-closed server user resolution.
 *
 * - Missing server auth secrets -> throws `AuthConfigurationError` (401).
 * - Missing / invalid session -> throws `UnauthorizedError` (401).
 * - `VITE_AUTH_ENABLED` is NEVER consulted and can never bypass authentication.
 */
export async function requireUserId(bearerToken?: string): Promise<string> {
  const policy = resolveServerAuthPolicy(process.env);
  if (!policy.configured) {
    throw new AuthConfigurationError(policy.reason);
  }
  const user = await getSessionUser(bearerToken);
  if (!user) throw new UnauthorizedError();
  return user.id;
}
