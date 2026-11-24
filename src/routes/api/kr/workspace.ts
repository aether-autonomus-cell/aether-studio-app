import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_ADAPTER_REGISTRY_SUMMARY } from "@/server/katharift/adapters";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { createNewProject, getOrCreateActiveWorkspace } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/workspace")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if (!auth.ok) return auth.response;

        try {
          const url = new URL(request.url);
          const requestedProjectId = url.searchParams.get("project_id")?.trim() || undefined;
          const workspace = await getOrCreateActiveWorkspace(auth.userId, requestedProjectId);
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
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          action?: "create_project";
          title?: string;
          logline?: string;
        };
        if (body.action !== "create_project") {
          return Response.json({ error: "Unsupported workspace action" }, { status: 400 });
        }

        try {
          const workspace = await createNewProject(auth.userId, {
            title: body.title,
            logline: body.logline,
          });
          return Response.json(
            {
              ...workspace,
              adapters: DEFAULT_ADAPTER_REGISTRY_SUMMARY,
            },
            { status: 201, headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          return krErrorResponse(err, "Failed to create new project", 500);
        }
      },
    },
  },
});
