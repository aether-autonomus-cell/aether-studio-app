import { createFileRoute } from "@tanstack/react-router";
import {
  checkSameOriginPost,
  isCloudDatabaseConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";
import { issuePairingForJob } from "@/server/studio/repository";

export const Route = createFileRoute("/api/2d/jobs/$jobId/pair")({
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
        try {
          const pairing = await issuePairingForJob(params.jobId, owner.ownerSub);
          return Response.json(pairing);
        } catch {
          return Response.json({ error: "Job not found" }, { status: 404 });
        }
      },
    },
  },
});
