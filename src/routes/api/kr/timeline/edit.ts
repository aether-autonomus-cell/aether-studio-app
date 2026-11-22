import { createFileRoute } from "@tanstack/react-router";
import type { KrTimelineV1 } from "@/packages/contracts/schemas";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { saveTimelineEditRevision } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/timeline/edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          expected_version?: number;
          action_label?: string;
          timeline?: KrTimelineV1;
        };
        if (
          !body.project_id ||
          typeof body.expected_version !== "number" ||
          !body.timeline
        ) {
          return Response.json(
            { error: "project_id, expected_version, and timeline are required" },
            { status: 400 },
          );
        }

        try {
          const res = await saveTimelineEditRevision({
            userId: auth.userId,
            projectId: body.project_id,
            expectedVersion: body.expected_version,
            actionLabel: body.action_label || "Timeline edit",
            timeline: body.timeline,
          });
          if (res.conflict) {
            return Response.json(res, { status: 409 });
          }
          return Response.json(res);
        } catch (err) {
          return krErrorResponse(err, "Failed to save timeline edit");
        }
      },
    },
  },
});
