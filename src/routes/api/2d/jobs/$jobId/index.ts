import { createFileRoute } from "@tanstack/react-router";
import { isCloudDatabaseConfigured, requireOwnerIdentity } from "@/server/studio/auth";
import { getOwnerJob } from "@/server/studio/repository";

export const Route = createFileRoute("/api/2d/jobs/$jobId/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json({ error: "CLOUD_MODE_UNCONFIGURED" }, { status: 503 });
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        const job = await getOwnerJob(params.jobId, owner.ownerSub);
        if (!job) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(job);
      },
    },
  },
});
