import { createFileRoute } from "@tanstack/react-router";
import { resolveDbPolicy } from "@/lib/db-policy";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { resolveServerAuthPolicy } from "@/server/katharift/auth-policy";

export type AuthStatusProvider = {
  providerId: string;
  label: string;
  flow: "social" | "oauth2";
};

export type AuthStatusResponse = {
  auth_configured: boolean;
  db_configured: boolean;
  ready: boolean;
  code: "DB_NOT_CONFIGURED" | "AUTH_NOT_CONFIGURED" | null;
  message: string;
  providers: AuthStatusProvider[];
};

export function buildAuthStatusResponse(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): AuthStatusResponse {
  const dbPolicy = resolveDbPolicy(env);
  const authPolicy = resolveServerAuthPolicy(env);
  const dbConfigured = dbPolicy.mode !== "unconfigured";

  if (!authPolicy.configured) {
    return {
      auth_configured: false,
      db_configured: dbConfigured,
      ready: false,
      code: "AUTH_NOT_CONFIGURED",
      message:
        "Server authentication is not yet configured (owner allowlist or OAuth/session secrets pending).",
      providers: [],
    };
  }

  if (!dbConfigured) {
    return {
      auth_configured: true,
      db_configured: false,
      ready: false,
      code: "DB_NOT_CONFIGURED",
      message: "Durable PostgreSQL database (DATABASE_URL) is not yet configured.",
      providers: [],
    };
  }

  const providers: AuthStatusProvider[] = [];
  if (authPolicy.hasGoogleOAuth) {
    providers.push({ providerId: "google", label: "Google", flow: "social" });
  } else if (authPolicy.hasOAuthClient) {
    for (const provider of GROK_PROVIDERS) {
      providers.push({
        providerId: provider.providerId,
        label: provider.label,
        flow: "oauth2",
      });
    }
  }

  return {
    auth_configured: true,
    db_configured: true,
    ready: true,
    code: null,
    message: "Owner sign-in ready.",
    providers,
  };
}

export const Route = createFileRoute("/api/kr/auth-status")({
  server: {
    handlers: {
      GET: () => Response.json(buildAuthStatusResponse(process.env)),
    },
  },
});
