import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeOAuthPkce, getNativeOAuthHandoffCode, NATIVE_BACKEND_ORIGIN, redeemNativeOAuthHandoff } from "./nativeOAuth";

afterEach(() => vi.unstubAllGlobals());

describe("native OAuth callback", () => {
  it("accepts only the exact NORAH custom callback scheme, host, and path", () => {
    const code = "A".repeat(43);
    expect(getNativeOAuthHandoffCode(`com.norah.app://oauth-callback?code=${code}`)).toBe(code);
    expect(getNativeOAuthHandoffCode(`https://example.com/?code=${code}`)).toBeNull();
    expect(getNativeOAuthHandoffCode(`com.norah.app://other?code=${code}`)).toBeNull();
    expect(getNativeOAuthHandoffCode(`com.norah.app://oauth-callback/other?code=${code}`)).toBeNull();
    expect(getNativeOAuthHandoffCode("not a URL")).toBeNull();
  });

  it("creates a valid S256 PKCE pair", async () => {
    const pair = await createNativeOAuthPkce();
    const expectedChallenge = createHash("sha256").update(pair.codeVerifier).digest("base64url");
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.codeChallenge).toBe(expectedChallenge);
  });

  it("redeems the opaque code with its verifier and validates the session payload", async () => {
    const code = "B".repeat(43);
    const codeVerifier = "C".repeat(43);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionToken: "session-token-test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(redeemNativeOAuthHandoff(code, codeVerifier)).resolves.toBe("session-token-test");
    expect(fetchMock).toHaveBeenCalledWith(`${NATIVE_BACKEND_ORIGIN}/api/oauth/native/session`, expect.objectContaining({
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({ code, codeVerifier }),
    }));
  });
});
