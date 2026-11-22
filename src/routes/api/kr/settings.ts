import { createFileRoute } from "@tanstack/react-router";
import type { KrSettingsSnapshot } from "@/packages/contracts/schemas";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { saveSettingsRevision } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/settings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          snapshot?: Partial<KrSettingsSnapshot>;
        };
        if (!body.project_id || !body.snapshot) {
          return Response.json({ error: "project_id and snapshot are required" }, { status: 400 });
        }

        // Strict server-side zero-spend enforcement: reject explicit paid_routes=true attempts
        const maybePaid = (body.snapshot as { zero_spend?: { paid_routes?: boolean } }).zero_spend?.paid_routes;
        if (maybePaid === true) {
          return Response.json(
            { error: "Zero-spend policy blocked request: paid_routes must remain false." },
            { status: 403 },
          );
        }

        try {
          const result = await saveSettingsRevision(auth.userId, body.project_id, body.snapshot);
          return Response.json(result);
        } catch (err) {
          return krErrorResponse(err, "Failed to save settings revision");
        }
      },
    },
  },
});
