import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isCloudDatabaseConfigured } from "@/server/studio/auth";
import { completeWorkerJob } from "@/server/studio/repository";
import { verifyJobCapability } from "@/server/studio/worker-auth";

const completeSchema = z.object({
  status: z.enum(["saved", "failed"]),
  report: z.record(z.string(), z.unknown()),
});

export const Route = createFileRoute("/api/2d/worker/complete")({
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
        const parsed = completeSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid completion report" }, { status: 400 });
        }
        const ok = await completeWorkerJob({
          jobId: cap.jobId,
          leaseToken: cap.leaseToken,
          status: parsed.data.status,
          report: parsed.data.report,
        });
        if (!ok) {
          return Response.json({ error: "Stale lease" }, { status: 409 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
