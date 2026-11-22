import { createFileRoute } from "@tanstack/react-router";
import { claimJobForWorker } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/worker/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          pairing_code?: string;
          gpu_name?: string;
          capabilities?: Record<string, unknown>;
        };
        if (!body.pairing_code?.trim()) {
          return Response.json({ error: "pairing_code is required" }, { status: 400 });
        }

        try {
          const claimed = await claimJobForWorker({
            pairingCode: body.pairing_code.trim(),
            gpuName: body.gpu_name,
            capabilities: body.capabilities,
          });
          return Response.json(claimed);
        } catch (err) {
          return krErrorResponse(err, "Worker claim rejected", 403);
        }
      },
    },
  },
});
