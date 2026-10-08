import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";
import { createNativeOAuthPkce, NATIVE_BACKEND_ORIGIN } from "@/lib/nativeOAuth";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
export const NATIVE_OAUTH_PKCE_STORAGE_KEY = "norah-native-oauth-pkce";

let nativeLoginOpen = false;

export function resetNativeLoginState() {
  nativeLoginOpen = false;
}

// Start the existing Manus web OAuth flow on the web. On Android, use a
// Custom Tab and the additive native backend route so the state cookie is set
// in the same browser that receives the provider callback. PKCE binds the
// one-time deep-link handoff to the NORAH WebView that initiated the flow.
export async function startLogin(): Promise<void> {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL?.trim();
  const appId = import.meta.env.VITE_APP_ID?.trim();
  if (!oauthPortalUrl || !appId) {
    toast.error("Sign-in is not configured for this build.");
    return;
  }

  if (Capacitor.isNativePlatform()) {
    if (nativeLoginOpen) return;
    nativeLoginOpen = true;
    try {
      const { codeVerifier, codeChallenge } = await createNativeOAuthPkce();
      localStorage.setItem(NATIVE_OAUTH_PKCE_STORAGE_KEY, JSON.stringify({ codeVerifier, createdAt: Date.now() }));
      const startUrl = new URL(`${NATIVE_BACKEND_ORIGIN}/api/oauth/native/start`);
      startUrl.searchParams.set("appId", appId);
      startUrl.searchParams.set("portalUrl", oauthPortalUrl);
      startUrl.searchParams.set("codeChallenge", codeChallenge);
      await Browser.open({ url: startUrl.toString(), toolbarColor: "#0A0910" });
    } catch (error) {
      nativeLoginOpen = false;
      try { localStorage.removeItem(NATIVE_OAUTH_PKCE_STORAGE_KEY); } catch {}
      console.error("[OAuth] Unable to open native sign-in", error);
      toast.error("Could not open sign-in. Make sure NORAH Core is running and try again.");
    }
    return;
  }

  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const nonce = crypto.randomUUID();
    document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
    const state = encodeOAuthState({ redirectUri, nonce });

    const url = new URL(`${oauthPortalUrl.replace(/\/+$/, "")}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    window.location.href = url.toString();
  } catch (error) {
    console.error("[OAuth] Unable to start browser sign-in", error);
    toast.error("Could not start sign-in. Please try again.");
  }
}
