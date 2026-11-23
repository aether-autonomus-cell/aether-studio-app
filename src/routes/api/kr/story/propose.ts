import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { createStoryPatchProposal } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/story/propose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          instruction?: string;
          expected_story_revision_id?: string;
        };
        if (!body.project_id || !body.instruction?.trim()) {
          return Response.json(
            { error: "project_id and non-empty instruction are required" },
            { status: 400 },
          );
        }

        try {
          const result = await createStoryPatchProposal(
            auth.userId,
            body.project_id,
            body.instruction.trim(),
            body.expected_story_revision_id,
          );
          return Response.json(result);
        } catch (err) {
          return krErrorResponse(err, "Failed to propose story patch");
        }
      },
    },
  },
});
