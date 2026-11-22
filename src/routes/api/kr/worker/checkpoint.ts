import { createFileRoute } from "@tanstack/react-router";
import type { KrSceneCheckpoint, KrWorkerEvent } from "@/packages/contracts/schemas";
import { postWorkerCheckpoint } from "@/server/katharift/repository";

export const Route = createFileRoute("/api/kr/worker/checkpoint")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          job_id?: string;
          worker_session_id?: string;
          lease_token?: string;
          seq?: number;
          scene_id?: string;
          stage?: KrWorkerEvent["stage"];
          checkpoint?: Partial<KrSceneCheckpoint>;
          message?: string;
          level?: "info" | "warn" | "error";
        };

        if (
          !body.job_id ||
          !body.worker_session_id ||
          !body.lease_token ||
          typeof body.seq !== "number" ||
          !body.scene_id ||
          !body.stage ||
          !body.message
        ) {
          return Response.json({ error: "Missing required checkpoint fields" }, { status: 400 });
        }

        try {
          const updatedJob = await postWorkerCheckpoint({
            jobId: body.job_id,
            workerSessionId: body.worker_session_id,
            leaseToken: body.lease_token,
            seq: body.seq,
            sceneId: body.scene_id,
            stage: body.stage,
            checkpointPatch: body.checkpoint ?? {},
            message: body.message,
            level: body.level,
          });
          return Response.json({ job: updatedJob });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Checkpoint failed";
          const status = msg.includes("lease_token") ? 409 : 400;
          return Response.json({ error: msg }, { status });
        }
      },
    },
  },
});
