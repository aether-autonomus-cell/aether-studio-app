import { createFileRoute } from "@tanstack/react-router";
import { isGoogleOAuthConfigured, requireOwnerIdentity } from "@/server/studio/auth";
import { buildGoogleOAuthUrl, createPkcePair } from "@/server/studio/google";

export const Route = createFileRoute("/api/2d/oauth/google/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isGoogleOAuthConfigured()) {
          return Response.json(
            {
              error: "GOOGLE_OAUTH_UNCONFIGURED",
              message:
                "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and AETHER_TOKEN_ENCRYPTION_KEY for server-managed OAuth, or use Colab Drive-stored user tokens in Route 1.",
            },
            { status: 501 },
          );
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        const url = new URL(request.url);
        const slot = url.searchParams.get("slot") === "english" ? "english" : "hindi";
        const scopeMode = url.searchParams.get("scope") ?? "youtube";
        const scopes =
          scopeMode === "drive"
            ? ["https://www.googleapis.com/auth/drive.file"]
            : [
                "https://www.googleapis.com/auth/drive.file",
                "https://www.googleapis.com/auth/youtube.upload",
              ];

        const pkce = createPkcePair();
        const redirectUri = `${url.origin}/api/2d/oauth/google/callback`;
        const authUrl = buildGoogleOAuthUrl({
          redirectUri,
          state: `${pkce.state}:${slot}`,
          codeChallenge: pkce.challenge,
          scopes,
        });

        const cookiePayload = Buffer.from(
          JSON.stringify({ state: `${pkce.state}:${slot}`, verifier: pkce.verifier, slot }),
          "utf8",
        ).toString("base64url");

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            "Set-Cookie": `aether_g_pkce=${cookiePayload}; HttpOnly; SameSite=Lax; Path=/api/2d/oauth/google; Max-Age=600`,
          },
        });
      },
    },
  },
});
