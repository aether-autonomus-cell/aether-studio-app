import { createFileRoute } from "@tanstack/react-router";
import {
  isCloudDatabaseConfigured,
  isGoogleOAuthConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";

export const Route = createFileRoute("/api/2d/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const dbConfigured = isCloudDatabaseConfigured();
        const oauthConfigured = isGoogleOAuthConfigured();
        const owner = dbConfigured
          ? await requireOwnerIdentity(request)
          : { authenticated: false, ownerSub: "", email: null };

        return Response.json(
          {
            mode: dbConfigured ? "cloud-ready" : "local-ready",
            keyless_ai: true,
            oauth_configured: oauthConfigured,
            database_configured: dbConfigured,
            owner_authenticated: owner.authenticated,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
