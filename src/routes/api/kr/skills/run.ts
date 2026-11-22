import { createFileRoute } from "@tanstack/react-router";
import { dispatchSkillTool, type SkillToolName } from "@/packages/skill-runtime/index";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { recordSkillTrace, runPackagingSkillCheck } from "@/server/katharift/repository";

export const Route = createFileRoute("/api/kr/skills/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          project_id?: string;
          mode?: "tool" | "packaging_audit";
          tool_name?: SkillToolName;
          args?: Record<string, unknown>;
          title?: string;
          thumbnail_text?: string;
        };

        if (body.mode === "packaging_audit") {
          if (!body.project_id || !body.title?.trim()) {
            return Response.json({ error: "project_id and title required" }, { status: 400 });
          }
          const res = await runPackagingSkillCheck(
            auth.userId,
            body.project_id,
            body.title.trim(),
            body.thumbnail_text,
          );
          return Response.json(res);
        }

        if (!body.tool_name) {
          return Response.json({ error: "tool_name is required" }, { status: 400 });
        }
        const res = dispatchSkillTool(body.tool_name, body.args ?? {});
        await recordSkillTrace(auth.userId, body.project_id ?? null, res.trace);
        return Response.json(res);
      },
    },
  },
});
