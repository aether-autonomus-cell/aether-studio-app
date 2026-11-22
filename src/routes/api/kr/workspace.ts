import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_ADAPTER_REGISTRY_SUMMARY } from "@/server/katharift/adapters";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { getOrCreateActiveWorkspace } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/workspace")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if (!auth.ok) return auth.response;

        try {
          const workspace = await getOrCreateActiveWorkspace(auth.userId);
          return Response.json(
            {
              ...workspace,
              adapters: DEFAULT_ADAPTER_REGISTRY_SUMMARY,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          return krErrorResponse(err, "Failed to load workspace", 500);
        }
      },
    },
  },
});
