import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkSameOriginPost,
  isCloudDatabaseConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";
import { createPublishIntent, getOwnerJob } from "@/server/studio/repository";

const intentSchema = z.object({
  channel_slot: z.enum(["hindi", "english"]),
  language: z.enum(["hi-IN", "en-US"]),
  artifact_sha256: z.string().min(16).max(128),
  metadata_sha256: z.string().min(16).max(128),
  privacy_status: z.enum(["private", "unlisted", "public"]).default("private"),
});

export const Route = createFileRoute("/api/2d/jobs/$jobId/publish-intents")({
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
        const job = await getOwnerJob(params.jobId, owner.ownerSub);
        if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

        const raw = await request.json().catch(() => null);
        const parsed = intentSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid publish intent" }, { status: 400 });
        }
        const intent = await createPublishIntent({
          jobId: params.jobId,
          channelSlot: parsed.data.channel_slot,
          language: parsed.data.language,
          artifactSha256: parsed.data.artifact_sha256,
          metadataSha256: parsed.data.metadata_sha256,
          privacyStatus: parsed.data.privacy_status,
        });
        return Response.json({ intent }, { status: 201 });
      },
    },
  },
});
