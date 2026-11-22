import { assertSameSiteRequest } from "@/lib/auth/isolation.server";
import { requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";

export async function authenticateApiRequest(
  request: Request,
  opts?: { checkSameOrigin?: boolean },
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  if (opts?.checkSameOrigin) {
    try {
      assertSameSiteRequest();
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Cross-site state mutation rejected" }, { status: 403 }),
      };
    }
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : undefined;

  try {
    const userId = await requireUserId(bearer);
    return { ok: true, userId };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return {
        ok: false,
        response: Response.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    return {
      ok: false,
      response: Response.json(
        { error: err instanceof Error ? err.message : "Authentication failure" },
        { status: 401 },
      ),
    };
  }
}
