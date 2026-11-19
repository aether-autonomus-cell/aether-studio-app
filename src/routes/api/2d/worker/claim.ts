import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isCloudDatabaseConfigured } from "@/server/studio/auth";
import { claimJobWithPairingCode } from "@/server/studio/repository";
import { signJobCapability } from "@/server/studio/worker-auth";

const claimSchema = z.object({
  pairing_code: z.string().min(8).max(24),
});

export const Route = createFileRoute("/api/2d/worker/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json({ error: "CLOUD_MODE_UNCONFIGURED" }, { status: 503 });
        }
        const raw = await request.json().catch(() => null);
        const parsed = claimSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid pairing code format" }, { status: 400 });
        }
        const claimed = await claimJobWithPairingCode(parsed.data.pairing_code);
        if (!claimed) {
          return Response.json({ error: "Pairing code invalid or expired" }, { status: 401 });
        }
        const capabilityToken = signJobCapability({
          jobId: claimed.job.job_id as string,
          leaseToken: claimed.leaseToken,
          exp: Date.now() + 4 * 60 * 60 * 1000,
        });
        return Response.json({
          job_id: claimed.job.job_id,
          packet: claimed.job.packet_json,
          packet_sha256: claimed.job.packet_sha256,
          capability_token: capabilityToken,
        });
      },
    },
  },
});
