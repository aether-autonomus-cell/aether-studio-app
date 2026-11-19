import { createFileRoute } from "@tanstack/react-router";
import { sceneGraphV1Schema } from "@/lib/studio/schema";
import {
  checkSameOriginPost,
  isCloudDatabaseConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";
import { createOrReuseJob, listOwnerJobs } from "@/server/studio/repository";

export const Route = createFileRoute("/api/2d/jobs/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json(
            { error: "CLOUD_MODE_UNCONFIGURED", mode: "local-ready" },
            { status: 503 },
          );
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        const jobs = await listOwnerJobs(owner.ownerSub);
        return Response.json({ jobs });
      },
      POST: async ({ request }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json(
            { error: "CLOUD_MODE_UNCONFIGURED", mode: "local-ready" },
            { status: 503 },
          );
        }
        if (!checkSameOriginPost(request)) {
          return Response.json({ error: "Forbidden origin" }, { status: 403 });
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        let raw: { packet?: unknown };
        try {
          raw = (await request.json()) as { packet?: unknown };
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const parsed = sceneGraphV1Schema.safeParse(raw?.packet);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid SceneGraphV1 packet", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
        const result = await createOrReuseJob({
          ownerSub: owner.ownerSub,
          packet: parsed.data,
          idempotencyKey,
        });
        return Response.json(result, { status: 201 });
      },
    },
  },
});
