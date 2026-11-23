import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { confirmAndEnqueueProductionJob } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/jobs/confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          idempotency_key?: string;
          confirmed_by_user?: boolean;
        };
        if (!body.project_id || !body.idempotency_key || body.idempotency_key.length < 8) {
          return Response.json(
            { error: "project_id and idempotency_key (>= 8 chars) are required" },
            { status: 400 },
          );
        }

        try {
          const res = await confirmAndEnqueueProductionJob({
            userId: auth.userId,
            projectId: body.project_id,
            idempotencyKey: body.idempotency_key,
            confirmedByUser: Boolean(body.confirmed_by_user),
          });
          return Response.json(res);
        } catch (err) {
          return krErrorResponse(err, "Failed to confirm production job");
        }
      },
    },
  },
});
