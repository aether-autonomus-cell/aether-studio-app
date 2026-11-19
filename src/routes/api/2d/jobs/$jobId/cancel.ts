import { createFileRoute } from "@tanstack/react-router";
import {
  checkSameOriginPost,
  isCloudDatabaseConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";
import { cancelOwnerJob } from "@/server/studio/repository";

export const Route = createFileRoute("/api/2d/jobs/$jobId/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json({ error: "CLOUD_MODE_UNCONFIGURED" }, { status: 503 });
        }
        if (!checkSameOriginPost(request)) {
          return Response.json({ error: "Forbidden origin" }, { status: 403 });
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        const cancelled = await cancelOwnerJob(params.jobId, owner.ownerSub);
        if (!cancelled) {
          return Response.json({ error: "Job not found or already completed" }, { status: 404 });
        }
        return Response.json(cancelled);
      },
    },
  },
});
