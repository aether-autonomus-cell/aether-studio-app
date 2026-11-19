import { createFileRoute } from "@tanstack/react-router";
import {
  isCloudDatabaseConfigured,
  isGoogleOAuthConfigured,
  requireOwnerIdentity,
} from "@/server/studio/auth";
import { encryptRefreshToken, exchangeGoogleCode } from "@/server/studio/google";
import { upsertEncryptedOAuthToken } from "@/server/studio/repository";

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export const Route = createFileRoute("/api/2d/oauth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isGoogleOAuthConfigured() || !isCloudDatabaseConfigured()) {
          return Response.json({ error: "GOOGLE_OAUTH_UNCONFIGURED" }, { status: 501 });
        }
        const owner = await requireOwnerIdentity(request);
        if (!owner.authenticated) {
          return Response.json({ error: "Owner sign-in required" }, { status: 401 });
        }
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const pkceCookie = readCookie(request, "aether_g_pkce");
        if (!code || !state || !pkceCookie) {
          return Response.json({ error: "Missing OAuth code or PKCE state" }, { status: 400 });
        }
        let cookieData: { state: string; verifier: string; slot: "hindi" | "english" };
        try {
          cookieData = JSON.parse(Buffer.from(pkceCookie, "base64url").toString("utf8"));
        } catch {
          return Response.json({ error: "Corrupted PKCE cookie" }, { status: 400 });
        }
        if (cookieData.state !== state) {
          return Response.json({ error: "OAuth state mismatch" }, { status: 403 });
        }
        const tokens = await exchangeGoogleCode({
          code,
          codeVerifier: cookieData.verifier,
          redirectUri: `${url.origin}/api/2d/oauth/google/callback`,
        });
        if (!tokens.refresh_token) {
          return Response.json(
            { error: "No refresh_token returned; revoke app access and retry consent." },
            { status: 400 },
          );
        }
        const encrypted = encryptRefreshToken(tokens.refresh_token);
        await upsertEncryptedOAuthToken({
          channelSlot: cookieData.slot,
          ownerSub: owner.ownerSub,
          scopes: tokens.scope ?? "",
          encryptedRefreshToken: encrypted,
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/?oauth=connected",
            "Set-Cookie":
              "aether_g_pkce=; HttpOnly; SameSite=Lax; Path=/api/2d/oauth/google; Max-Age=0",
          },
        });
      },
    },
  },
});
