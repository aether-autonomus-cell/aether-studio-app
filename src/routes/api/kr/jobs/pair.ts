import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { createWorkerPairingSession } from "@/server/katharift/repository";

export const Route = createFileRoute("/api/kr/jobs/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          runtime_kind?: "colab_free_gpu" | "local_python_worker";
        };
        if (!body.project_id) {
          return Response.json({ error: "project_id is required" }, { status: 400 });
        }

        try {
          const session = await createWorkerPairingSession(
            auth.userId,
            body.project_id,
            body.runtime_kind ?? "colab_free_gpu",
          );
          return Response.json(session);
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to create worker pairing session" },
            { status: 400 },
          );
        }
      },
    },
  },
});
