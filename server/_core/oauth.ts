import { randomBytes } from "node:crypto";
import {
  COOKIE_NAME,
  NATIVE_OAUTH_REDIRECT_URI,
  ONE_YEAR_MS,
  OAUTH_STATE_COOKIE,
  decodeOAuthState,
  encodeOAuthState,
} from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { consumeNativeOAuthHandoff, createNativeOAuthHandoff } from "./nativeOAuthHandoff";
import { sdk } from "./sdk";

const NATIVE_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const NATIVE_APP_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getNativePortalUrl(rawUrl: string | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function registerOAuthRoutes(app: Express) {
  // Open the native login in the system browser. The browser first visits this
  // same loopback origin, so the host-only OAuth state cookie is set in the
  // same cookie jar that will receive the provider callback.
  app.get("/api/oauth/native/start", (req: Request, res: Response) => {
    const appId = getQueryParam(req, "appId");
    const portalUrl = getNativePortalUrl(getQueryParam(req, "portalUrl"));
    const codeChallenge = getQueryParam(req, "codeChallenge");
    const hostname = req.hostname.toLowerCase();
    const localPort = req.socket.localPort;

    if (!NATIVE_LOOPBACK_HOSTS.has(hostname) || !localPort) {
      res.status(400).send("Native sign-in must start from the local NORAH Core server.");
      return;
    }
    if (!ENV.appId || appId !== ENV.appId) {
      res.status(503).send("The app ID in this build does not match NORAH Core.");
      return;
    }
    if (!portalUrl) {
      res.status(400).send("The OAuth portal URL must be a valid HTTPS URL.");
      return;
    }
    if (!codeChallenge || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) {
      res.status(400).send("A valid S256 PKCE challenge is required for native sign-in.");
      return;
    }

    const nonce = randomBytes(24).toString("base64url");
    const redirectUri = `http://${hostname}:${localPort}/api/oauth/callback`;
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
      sameSite: "none",
      secure: true,
    });

    const state = encodeOAuthState({
      redirectUri,
      nonce,
      nativeRedirectUri: NATIVE_OAUTH_REDIRECT_URI,
      codeChallenge,
    });
    const authUrl = new URL(`${portalUrl.toString().replace(/\/+$/, "")}/app-auth`);
    authUrl.searchParams.set("appId", ENV.appId);
    authUrl.searchParams.set("redirectUri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("type", "signIn");
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, authUrl.toString());
  });

  // Redeem a random, short-lived code after Android reopens NORAH through its
  // custom URL scheme. PKCE binds it to the WebView that initiated login; the
  // long-lived session token itself never enters a deep-link URL.
  app.post("/api/oauth/native/session", (req: Request, res: Response) => {
    const origin = req.get("origin");
    if (!origin || !NATIVE_APP_ORIGINS.has(origin)) {
      res.status(403).json({ error: "native app origin is not allowed" });
      return;
    }

    const body = req.body as { code?: unknown; codeVerifier?: unknown } | undefined;
    if (typeof body?.code !== "string" || typeof body.codeVerifier !== "string") {
      res.status(400).json({ error: "handoff code and PKCE verifier are required" });
      return;
    }

    const sessionToken = consumeNativeOAuthHandoff(body.code, body.codeVerifier);
    if (!sessionToken) {
      res.status(410).json({ error: "handoff code is invalid, expired, or already used" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({ sessionToken });
  });

  // Existing browser OAuth callback. The native branch is additive: it reuses
  // the same nonce guard, provider code exchange, user sync, and session issuer.
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    const oauthState = decodeOAuthState(state);
    const { nonce } = oauthState;
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      if (oauthState.nativeRedirectUri === NATIVE_OAUTH_REDIRECT_URI) {
        if (!oauthState.codeChallenge || !PKCE_CHALLENGE_PATTERN.test(oauthState.codeChallenge)) {
          res.status(400).json({ error: "native sign-in is missing a valid PKCE challenge" });
          return;
        }
        const handoffCode = createNativeOAuthHandoff(sessionToken, oauthState.codeChallenge);
        const appUrl = new URL(NATIVE_OAUTH_REDIRECT_URI);
        appUrl.searchParams.set("code", handoffCode);
        res.setHeader("Cache-Control", "no-store");
        res.redirect(302, appUrl.toString());
        return;
      }

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
