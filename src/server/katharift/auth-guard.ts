import {
  AuthConfigurationError,
  resolveServerAuthPolicy,
  type ServerAuthPolicy,
} from "./auth-policy.ts";

export type AuthGuardDeps = {
  env?: Record<string, string | undefined>;
  assertSameSite?: () => void;
  resolveUserId?: (bearerToken?: string) => Promise<string>;
};

export async function authenticateApiRequest(
  request: Request,
  opts?: { checkSameOrigin?: boolean; deps?: AuthGuardDeps },
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const env = opts?.deps?.env ?? process.env;
  const policy: ServerAuthPolicy = resolveServerAuthPolicy(env);

  if (!policy.configured) {
    return {
      ok: false,
      response: Response.json(
        { error: policy.reason, code: policy.code },
        { status: 401 },
      ),
    };
  }

  if (opts?.checkSameOrigin) {
    try {
      if (opts?.deps?.assertSameSite) {
        opts.deps.assertSameSite();
      } else {
        const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
        assertSameSiteRequest();
      }
    } catch {
      return {
        ok: false,
        response: Response.json(
          { error: "Cross-site state mutation rejected", code: "CROSS_SITE_FORBIDDEN" },
          { status: 403 },
        ),
      };
    }
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : undefined;

  try {
    let userId: string;
    if (opts?.deps?.resolveUserId) {
      userId = await opts.deps.resolveUserId(bearer);
    } else {
      const { requireUserId } = await import("@/lib/auth/verify.server");
      userId = await requireUserId(bearer);
    }
    return { ok: true, userId };
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      return {
        ok: false,
        response: Response.json(
          { error: err.message, code: err.code },
          { status: 401 },
        ),
      };
    }
    if (
      err instanceof Error &&
      (err.name === "UnauthorizedError" || (err as { status?: number }).status === 401)
    ) {
      return {
        ok: false,
        response: Response.json(
          { error: "Unauthorized", code: "UNAUTHORIZED" },
          { status: 401 },
        ),
      };
    }
    return {
      ok: false,
      response: Response.json(
        {
          error: err instanceof Error ? err.message : "Authentication failure",
          code: "UNAUTHORIZED",
        },
        { status: 401 },
      ),
    };
  }
}
