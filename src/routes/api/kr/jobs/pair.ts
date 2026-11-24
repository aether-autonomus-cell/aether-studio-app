import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import {
  createWorkerPairingSession,
  revokeWorkerPairingSession,
} from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/jobs/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          action?: "create" | "revoke";
          project_id?: string;
          worker_session_id?: string;
          runtime_kind?: "colab_free_gpu" | "local_python_worker";
        };
        if (!body.project_id) {
          return Response.json({ error: "project_id is required" }, { status: 400 });
        }

        try {
          if (body.action === "revoke") {
            if (!body.worker_session_id) {
              return Response.json(
                { error: "worker_session_id is required to revoke a pairing code" },
                { status: 400 },
              );
            }
            const revoked = await revokeWorkerPairingSession(
              auth.userId,
              body.project_id,
              body.worker_session_id,
            );
            return Response.json(revoked);
          }

          const session = await createWorkerPairingSession(
            auth.userId,
            body.project_id,
            body.runtime_kind ?? "colab_free_gpu",
          );
          return Response.json(session);
        } catch (err) {
          return krErrorResponse(err, "Failed to manage worker pairing session");
        }
      },
    },
  },
});
