import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { consumeNativeOAuthHandoff, createNativeOAuthHandoff } from "./nativeOAuthHandoff";

const verifier = "V".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("native OAuth handoff", () => {
  it("requires the matching PKCE verifier and exchanges the code exactly once", () => {
    const code = createNativeOAuthHandoff("session-token-test", challenge, 1_000);

    expect(code).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(consumeNativeOAuthHandoff(code, "W".repeat(43), 59_000)).toBeNull();
    expect(consumeNativeOAuthHandoff(code, verifier, 59_000)).toBe("session-token-test");
    expect(consumeNativeOAuthHandoff(code, verifier, 59_001)).toBeNull();
  });

  it("rejects an expired handoff", () => {
    const code = createNativeOAuthHandoff("expired-session-token-test", challenge, 1_000);

    expect(consumeNativeOAuthHandoff(code, verifier, 61_000)).toBeNull();
  });
});
