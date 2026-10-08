import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { toast } from "sonner";
import App from "./App";
import { NATIVE_OAUTH_PKCE_STORAGE_KEY, resetNativeLoginState, startLogin } from "./const";
import { getNativeOAuthHandoffCode, NATIVE_BACKEND_ORIGIN, redeemNativeOAuthHandoff } from "./lib/nativeOAuth";
import "./index.css";

const queryClient = new QueryClient();
const processedNativeCodes = new Set<string>();
const NATIVE_PKCE_TTL_MS = 10 * 60 * 1000;

const handleNativeOAuthReturn = async (url: string) => {
  const code = getNativeOAuthHandoffCode(url);
  if (!code || processedNativeCodes.has(code)) return;
  processedNativeCodes.add(code);
  if (processedNativeCodes.size > 32) {
    const oldest = processedNativeCodes.values().next().value;
    if (oldest) processedNativeCodes.delete(oldest);
  }

  try {
    const saved = JSON.parse(localStorage.getItem(NATIVE_OAUTH_PKCE_STORAGE_KEY) || "null") as {
      codeVerifier?: unknown;
      createdAt?: unknown;
    } | null;
    if (
      !saved || typeof saved.codeVerifier !== "string" || typeof saved.createdAt !== "number" ||
      Date.now() - saved.createdAt > NATIVE_PKCE_TTL_MS || saved.createdAt > Date.now() + 30_000
    ) throw new Error("The sign-in verifier is missing or expired. Please start sign-in again.");

    const sessionToken = await redeemNativeOAuthHandoff(code, saved.codeVerifier);
    sessionStorage.setItem("manus-cookie", `${COOKIE_NAME}=${sessionToken}`);
    resetNativeLoginState();
    void Browser.close().catch(() => undefined);
    await queryClient.invalidateQueries();
    toast.success("You’re signed in.");
  } catch (error) {
    resetNativeLoginState();
    console.error("[OAuth] Native sign-in handoff failed", error);
    toast.error("Sign-in could not be completed. Please try again.");
  } finally {
    try { localStorage.removeItem(NATIVE_OAUTH_PKCE_STORAGE_KEY); } catch {}
  }
};

if (Capacitor.isNativePlatform()) {
  void (async () => {
    try {
      await CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        void handleNativeOAuthReturn(url);
      });
      await Browser.addListener("browserFinished", resetNativeLoginState);
      const launch = await CapacitorApp.getLaunchUrl();
      if (launch?.url) await handleNativeOAuthReturn(launch.url);
    } catch (error) {
      console.error("[OAuth] Could not register the native callback handler", error);
    }
  })();
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;
  void startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const TRPC_URL = Capacitor.isNativePlatform()
  ? `${NATIVE_BACKEND_ORIGIN}/api/trpc`
  : "/api/trpc";

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      transformer: superjson,
      headers() {
        // The native OAuth bridge stores its one-time redeemed session here.
        // This existing bearer fallback also supports preview/WebView cookie
        // restrictions; the server still prefers its regular cookie when present.
        try {
          const raw = sessionStorage.getItem("manus-cookie");
          if (raw) {
            const prefix = `${COOKIE_NAME}=`;
            const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
            const token = pair?.trim().slice(prefix.length);
            if (token) return { Authorization: `Bearer ${token}` };
          }
        } catch {
          // sessionStorage unavailable
        }
        return {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
