import { NATIVE_OAUTH_REDIRECT_URI } from "@shared/const";

export const NATIVE_BACKEND_ORIGIN = "http://127.0.0.1:3000";

const nativeCallback = new URL(NATIVE_OAUTH_REDIRECT_URI);
const BASE64URL_32_BYTE_VALUE = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createNativeOAuthPkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = toBase64Url(random);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: toBase64Url(new Uint8Array(digest)) };
}

export function getNativeOAuthHandoffCode(callbackUrl: string): string | null {
  try {
    const url = new URL(callbackUrl);
    if (
      url.protocol !== nativeCallback.protocol ||
      url.hostname !== nativeCallback.hostname ||
      url.pathname !== nativeCallback.pathname
    ) return null;
    const code = url.searchParams.get("code");
    return code && BASE64URL_32_BYTE_VALUE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export async function redeemNativeOAuthHandoff(code: string, codeVerifier: string): Promise<string> {
  if (!BASE64URL_32_BYTE_VALUE.test(code) || !BASE64URL_32_BYTE_VALUE.test(codeVerifier)) {
    throw new Error("Invalid native sign-in handoff code or verifier.");
  }

  const response = await fetch(`${NATIVE_BACKEND_ORIGIN}/api/oauth/native/session`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });

  if (!response.ok) throw new Error(`Native sign-in handoff failed (${response.status}).`);
  const payload = (await response.json()) as { sessionToken?: unknown };
  if (typeof payload.sessionToken !== "string" || payload.sessionToken.length === 0) {
    throw new Error("Native sign-in response did not include a session token.");
  }
  return payload.sessionToken;
}
