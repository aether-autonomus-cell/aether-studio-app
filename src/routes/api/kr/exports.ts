import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { createOrRenderExport } from "@/server/katharift/repository";

export const Route = createFileRoute("/api/kr/exports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          format?: "mp4_hi" | "mp4_en" | "srt_hi" | "srt_en" | "bundle_json";
        };
        if (!body.project_id || !body.format) {
          return Response.json({ error: "project_id and format are required" }, { status: 400 });
        }

        try {
          const result = await createOrRenderExport({
            userId: auth.userId,
            projectId: body.project_id,
            format: body.format,
          });
          return Response.json(result);
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Export failed" },
            { status: 400 },
          );
        }
      },
    },
  },
});
