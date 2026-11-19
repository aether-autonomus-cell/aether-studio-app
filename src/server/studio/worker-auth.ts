import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env.server";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function workerSecret(): string {
  return (
    env("AETHER_WORKER_HMAC_SECRET") ??
    env("BETTER_AUTH_SECRET") ??
    "aether-dev-ephemeral-worker-secret"
  );
}

/** Generate a 12-character one-time pairing code (10-minute TTL). */
export function generatePairingCode(): { code: string; codeHash: string; expiresAt: Date } {
  const bytes = randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i += 1) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  return { code, codeHash: hashPairingCode(code), expiresAt };
}

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function generateLeaseToken(): string {
  return randomBytes(18).toString("hex");
}

export interface JobCapabilityPayload {
  jobId: string;
  leaseToken: string;
  exp: number;
}

export function signJobCapability(payload: JobCapabilityPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", workerSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyJobCapability(token: string): JobCapabilityPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", workerSecret()).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as JobCapabilityPayload;
    if (!parsed.jobId || !parsed.leaseToken || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
