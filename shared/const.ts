export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// One-time nonce cookie that binds an OAuth login to the browser that started
// it. The `__Host-` prefix forces the cookie host-only (Secure, Path=/, no
// Domain), so a sibling *.manus.space site cannot plant a matching value in a
// victim's browser.
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";
export const NATIVE_OAUTH_REDIRECT_URI = "com.norah.app://oauth-callback";

// `state` carries the provider callback URI plus a CSRF nonce. Native login
// additionally carries a fixed app return URI and an optional S256 PKCE
// challenge; the server validates it before issuing a one-time session handoff.
export type OAuthState = {
  redirectUri: string;
  nonce?: string;
  nativeRedirectUri?: string;
  codeChallenge?: string;
};

export const encodeOAuthState = (state: OAuthState): string =>
  btoa(JSON.stringify(state));

export const decodeOAuthState = (state: string): OAuthState => {
  let decoded: string;
  try {
    decoded = atob(state);
  } catch {
    // Malformed base64 (e.g. attacker-supplied garbage). Return no nonce so the
    // callback's CSRF guard rejects it with 403 — never throw, since the caller
    // runs outside the request handler's try/catch.
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (parsed && typeof parsed.redirectUri === "string") {
      return {
        redirectUri: parsed.redirectUri,
        nonce: typeof parsed.nonce === "string" ? parsed.nonce : undefined,
        nativeRedirectUri: typeof parsed.nativeRedirectUri === "string" ? parsed.nativeRedirectUri : undefined,
        codeChallenge: typeof parsed.codeChallenge === "string" ? parsed.codeChallenge : undefined,
      };
    }
  } catch {
    // Legacy links: `state` was a bare base64(redirectUri) with no nonce.
  }
  return { redirectUri: decoded };
};
