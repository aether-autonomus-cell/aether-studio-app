import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { resolveServerAuthPolicy } from "@/server/katharift/auth-policy";
import { krErrorResponse } from "@/server/katharift/route-errors";

async function handleAuth(request: Request): Promise<Response> {
  const policy = resolveServerAuthPolicy(process.env);
  if (!policy.configured) {
    return Response.json(
      { error: policy.reason, code: policy.code },
      { status: 503 },
    );
  }
  try {
    return await auth.handler(request);
  } catch (err) {
    return krErrorResponse(err, "Authentication handler failed", 500);
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
