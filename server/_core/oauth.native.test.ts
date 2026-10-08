import { createHash } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeOAuthState, encodeOAuthState, NATIVE_OAUTH_REDIRECT_URI, OAUTH_STATE_COOKIE } from "@shared/const";

const mocks = vi.hoisted(() => {
  process.env.VITE_APP_ID = "norah-test-app";
  return {
    exchangeCodeForToken: vi.fn(async () => ({ accessToken: "provider-access-test" })),
    getUserInfo: vi.fn(async () => ({
      openId: "norah-test-user",
      name: "Norah Test",
      email: "norah-test@example.invalid",
      platform: "test",
      loginMethod: "test",
    })),
    createSessionToken: vi.fn(async () => "norah-session-token-test"),
    upsertUser: vi.fn(async () => undefined),
  };
});

vi.mock("../db", () => ({ upsertUser: mocks.upsertUser }));
vi.mock("./sdk", () => ({
  sdk: {
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    getUserInfo: mocks.getUserInfo,
    createSessionToken: mocks.createSessionToken,
  },
}));

import { registerOAuthRoutes } from "./oauth";

describe("native OAuth bridge", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    mocks.exchangeCodeForToken.mockClear();
    mocks.getUserInfo.mockClear();
    mocks.createSessionToken.mockClear();
    mocks.upsertUser.mockClear();
  });

  it("starts OAuth on loopback and exchanges a one-time PKCE-bound native handoff", async () => {
    const codeVerifier = "C".repeat(43);
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const startUrl = new URL(`${baseUrl}/api/oauth/native/start`);
    startUrl.searchParams.set("appId", "norah-test-app");
    startUrl.searchParams.set("portalUrl", "https://oauth.example.test");
    startUrl.searchParams.set("codeChallenge", codeChallenge);
    const startResponse = await fetch(startUrl, { redirect: "manual" });

    expect(startResponse.status).toBe(302);
    const setCookie = startResponse.headers.get("set-cookie") ?? "";
    const nonce = setCookie.match(/__Host-oauth_state=([^;]+)/)?.[1];
    expect(nonce).toBeTruthy();

    const authUrl = new URL(startResponse.headers.get("location") ?? "");
    expect(authUrl.origin).toBe("https://oauth.example.test");
    expect(authUrl.pathname).toBe("/app-auth");
    expect(authUrl.searchParams.get("appId")).toBe("norah-test-app");
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(decodeOAuthState(state as string)).toEqual(expect.objectContaining({
      redirectUri: `${baseUrl}/api/oauth/callback`,
      nonce,
      nativeRedirectUri: NATIVE_OAUTH_REDIRECT_URI,
      codeChallenge,
    }));

    const callbackUrl = new URL(`${baseUrl}/api/oauth/callback`);
    callbackUrl.searchParams.set("code", "provider-code-test");
    callbackUrl.searchParams.set("state", state as string);
    const callbackResponse = await fetch(callbackUrl, {
      headers: { Cookie: `${OAUTH_STATE_COOKIE}=${nonce}` },
      redirect: "manual",
    });

    expect(callbackResponse.status).toBe(302);
    expect(mocks.exchangeCodeForToken).toHaveBeenCalledWith("provider-code-test", state);
    const appReturn = new URL(callbackResponse.headers.get("location") ?? "");
    expect(`${appReturn.protocol}//${appReturn.hostname}`).toBe("com.norah.app://oauth-callback");
    const handoffCode = appReturn.searchParams.get("code");
    expect(handoffCode).toBeTruthy();

    const exchange = (verifier: string, origin = "https://localhost") => fetch(`${baseUrl}/api/oauth/native/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ code: handoffCode, codeVerifier: verifier }),
    });
    expect((await exchange("D".repeat(43))).status).toBe(410);
    expect((await exchange(codeVerifier, "https://attacker.example")).status).toBe(403);

    const sessionResponse = await exchange(codeVerifier);
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({ sessionToken: "norah-session-token-test" });
    expect((await exchange(codeVerifier)).status).toBe(410);
  });

  it("keeps the existing browser callback redirect and session cookie behavior", async () => {
    const state = encodeOAuthState({
      redirectUri: "https://norah.example/api/oauth/callback",
      nonce: "web-nonce-test",
    });
    const callbackUrl = new URL(`${baseUrl}/api/oauth/callback`);
    callbackUrl.searchParams.set("code", "web-provider-code-test");
    callbackUrl.searchParams.set("state", state);
    const response = await fetch(callbackUrl, {
      headers: { Cookie: `${OAUTH_STATE_COOKIE}=web-nonce-test` },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("app_session_id=norah-session-token-test");
  });
});
