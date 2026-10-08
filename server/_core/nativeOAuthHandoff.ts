import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HANDOFF_TTL_MS = 60_000;
const MAX_PENDING_HANDOFFS = 512;
const pendingHandoffs = new Map<string, { sessionToken: string; codeChallenge: string; expiresAt: number }>();
const BASE64URL_32_BYTE_VALUE = /^[A-Za-z0-9_-]{43}$/;

function pruneHandoffs(now: number) {
  pendingHandoffs.forEach((handoff, code) => {
    if (handoff.expiresAt <= now) pendingHandoffs.delete(code);
  });
  while (pendingHandoffs.size >= MAX_PENDING_HANDOFFS) {
    const oldestCode = pendingHandoffs.keys().next().value;
    if (!oldestCode) break;
    pendingHandoffs.delete(oldestCode);
  }
}

export function createNativeOAuthHandoff(
  sessionToken: string,
  codeChallenge: string,
  now = Date.now(),
): string {
  if (!sessionToken || !BASE64URL_32_BYTE_VALUE.test(codeChallenge)) {
    throw new Error("Native OAuth handoff requires a session token and S256 PKCE challenge.");
  }
  pruneHandoffs(now);
  const code = randomBytes(32).toString("base64url");
  pendingHandoffs.set(code, { sessionToken, codeChallenge, expiresAt: now + HANDOFF_TTL_MS });
  return code;
}

export function consumeNativeOAuthHandoff(code: string, codeVerifier: string, now = Date.now()): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !BASE64URL_32_BYTE_VALUE.test(codeVerifier)) return null;
  const handoff = pendingHandoffs.get(code);
  if (!handoff) return null;
  if (handoff.expiresAt <= now) {
    pendingHandoffs.delete(code);
    return null;
  }

  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const expected = Buffer.from(handoff.codeChallenge);
  const actual = Buffer.from(challenge);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  pendingHandoffs.delete(code);
  return handoff.sessionToken;
}
