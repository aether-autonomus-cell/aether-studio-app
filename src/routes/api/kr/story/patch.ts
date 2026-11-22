import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { resolveStoryPatch, toggleSceneCanonLock } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/story/patch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          patch_id?: string;
          action?: "accept" | "reject" | "rebase" | "toggle_canon_lock";
          scene_id?: string;
          locked?: boolean;
        };

        if (!body.project_id || !body.action) {
          return Response.json({ error: "project_id and action are required" }, { status: 400 });
        }

        try {
          if (body.action === "toggle_canon_lock") {
            if (!body.scene_id || typeof body.locked !== "boolean") {
              return Response.json({ error: "scene_id and locked boolean required" }, { status: 400 });
            }
            const res = await toggleSceneCanonLock(auth.userId, body.project_id, body.scene_id, body.locked);
            return Response.json(res);
          }

          if (!body.patch_id) {
            return Response.json({ error: "patch_id is required" }, { status: 400 });
          }

          const res = await resolveStoryPatch({
            userId: auth.userId,
            projectId: body.project_id,
            patchId: body.patch_id,
            action: body.action,
          });
          if (res.status === "conflict") {
            return Response.json(res, { status: 409 });
          }
          return Response.json(res);
        } catch (err) {
          return krErrorResponse(err, "Failed to resolve patch");
        }
      },
    },
  },
});
