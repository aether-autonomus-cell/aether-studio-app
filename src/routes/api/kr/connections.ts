import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest } from "@/server/katharift/auth-guard";
import { upsertConnection } from "@/server/katharift/repository";
import { krErrorResponse } from "@/server/katharift/route-errors";

export const Route = createFileRoute("/api/kr/connections")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request, { checkSameOrigin: true });
        if (!auth.ok) return auth.response;

        const body = (await request.json().catch(() => ({}))) as {
          provider?: "google_drive" | "google_gemini_free" | "groq_free" | "openrouter_free";
          account_label?: string;
          secret?: string;
        };
        if (!body.provider || !body.account_label?.trim()) {
          return Response.json({ error: "provider and account_label are required" }, { status: 400 });
        }

        try {
          const res = await upsertConnection({
            userId: auth.userId,
            provider: body.provider,
            accountLabel: body.account_label.trim(),
            secretValue: body.secret,
          });
          return Response.json(res);
        } catch (err) {
          return krErrorResponse(err, "Failed to save connection");
        }
      },
    },
  },
});
