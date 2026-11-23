import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import {
  assertVerifiedOwnerIdentity,
  parseOwnerEmailAllowlist,
  resolveServerAuthPolicy,
} from "../../server/katharift/auth-policy";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import { GROK_PROVIDERS } from "./providers";
import { pgliteDialect } from "./pglite-dialect";
import { GROK_ISSUER_DEFAULT, PREVIEW_ALLOWED_HOSTS } from "./preview";

void ensureDbReady().catch(() => undefined);

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

const authPolicy = resolveServerAuthPolicy(process.env);

const grokIssuer = env("GROK_AUTH_ISSUER") ?? GROK_ISSUER_DEFAULT;
const grokClientId = env("GROK_AUTH_CLIENT_ID");
const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET");
const googleClientId = env("GOOGLE_CLIENT_ID");
const googleClientSecret = env("GOOGLE_CLIENT_SECRET");

/**
 * True only when required server-side auth secrets (and owner allowlist for
 * Google OAuth) are present. VITE_AUTH_ENABLED cannot enable or bypass auth.
 */
export const authConfigured = authPolicy.configured;

const explicitBaseURL = env("BETTER_AUTH_URL");
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];
const baseURL = explicitBaseURL ?? {
  allowedHosts: [...previewAllowedHosts, "localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...LOCAL_DEV_ORIGINS]
  : [
      ...previewAllowedHosts,
      ...previewAllowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      ...LOCAL_DEV_ORIGINS,
    ];

const databaseUrl = env("DATABASE_URL");

const issuerBase = grokIssuer.replace(/\/+$/, "");
const grokAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const grokTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const grokUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

const grokOAuthPlugin =
  authConfigured && grokClientId && grokClientSecret
    ? genericOAuth({
        config: GROK_PROVIDERS.map(({ providerId, idp }) => ({
          providerId,
          clientId: grokClientId,
          clientSecret: grokClientSecret,
          authorizationUrl: grokAuthorizationUrl,
          tokenUrl: grokTokenUrl,
          userInfoUrl: grokUserInfoUrl,
          scopes: ["openid", "profile", "email"],
          authorizationUrlParams: { idp, prompt: "login" },
        })),
      })
    : null;

const hasGoogleSocial = Boolean(authConfigured && googleClientId && googleClientSecret);

export const auth = betterAuth({
  baseURL,
  // Placeholder allows Vite static build to import this module without secrets;
  // request verification fails closed in verify.server.ts / auth-guard.ts when
  // BETTER_AUTH_SECRET is absent.
  secret: env("BETTER_AUTH_SECRET") ?? "__unconfigured_fail_closed_placeholder__",
  database,
  trustedOrigins,
  ...(hasGoogleSocial && googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            prompt: "select_account",
          },
        },
      }
    : {}),
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [
        "google",
        ...GROK_PROVIDERS.map((p) => p.providerId),
        GATE_PROVIDER_ID,
      ],
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const policy = resolveServerAuthPolicy(process.env);
          if (!policy.configured) {
            throw APIError.from("UNAUTHORIZED", {
              code: "AUTH_NOT_CONFIGURED",
              message: policy.reason,
            });
          }
          const allowlist = parseOwnerEmailAllowlist(process.env);
          if (policy.hasGoogleOAuth || allowlist.length > 0) {
            try {
              assertVerifiedOwnerIdentity(
                {
                  email: typeof user.email === "string" ? user.email : null,
                  emailVerified: Boolean(user.emailVerified),
                },
                process.env,
                { requireAllowlist: policy.hasGoogleOAuth },
              );
            } catch (err) {
              throw APIError.from("FORBIDDEN", {
                code: "OWNER_FORBIDDEN",
                message:
                  err instanceof Error
                    ? err.message
                    : "Access restricted to the verified studio owner.",
              });
            }
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, ctx) => {
          const policy = resolveServerAuthPolicy(process.env);
          if (!policy.configured) {
            throw APIError.from("UNAUTHORIZED", {
              code: "AUTH_NOT_CONFIGURED",
              message: policy.reason,
            });
          }
          const allowlist = parseOwnerEmailAllowlist(process.env);
          if ((policy.hasGoogleOAuth || allowlist.length > 0) && ctx) {
            const user = await ctx.context.internalAdapter
              .findUserById(session.userId)
              .catch(() => null);
            try {
              assertVerifiedOwnerIdentity(
                {
                  email: user?.email ?? null,
                  emailVerified: Boolean(user?.emailVerified),
                },
                process.env,
                { requireAllowlist: policy.hasGoogleOAuth },
              );
            } catch (err) {
              throw APIError.from("FORBIDDEN", {
                code: "OWNER_FORBIDDEN",
                message:
                  err instanceof Error
                    ? err.message
                    : "Access restricted to the verified studio owner.",
              });
            }
          }
        },
      },
    },
  },
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-grok-auth.session_data" },
      account_data: { name: "__Host-grok-auth.account_data" },
      dont_remember: { name: "__Host-grok-auth.dont_remember" },
    },
  },
  plugins: [
    gateIdentitySessions(),
    ...(grokOAuthPlugin ? [grokOAuthPlugin] : []),
    bearer(),
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

export { GROK_PROVIDERS } from "./providers";
