import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isCloudDatabaseConfigured } from "@/server/studio/auth";
import { recordWorkerHeartbeat } from "@/server/studio/repository";
import { verifyJobCapability } from "@/server/studio/worker-auth";

const heartbeatSchema = z.object({
  phase: z.enum(["PREFLIGHT", "SPEECH", "TIMING", "RENDERING", "MUXING", "VERIFYING", "SAVED"]),
  message: z.string().min(1).max(500),
});

export const Route = createFileRoute("/api/2d/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isCloudDatabaseConfigured()) {
          return Response.json({ error: "CLOUD_MODE_UNCONFIGURED" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const cap = token ? verifyJobCapability(token) : null;
        if (!cap) {
          return Response.json({ error: "Invalid worker capability token" }, { status: 401 });
        }
        const raw = await request.json().catch(() => null);
        const parsed = heartbeatSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid heartbeat payload" }, { status: 400 });
        }
        const ok = await recordWorkerHeartbeat({
          jobId: cap.jobId,
          leaseToken: cap.leaseToken,
          phase: parsed.data.phase,
          message: parsed.data.message,
        });
        if (!ok) {
          return Response.json({ error: "Stale lease or cancelled job" }, { status: 409 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
