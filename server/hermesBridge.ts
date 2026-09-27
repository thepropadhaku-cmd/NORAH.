import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";
import type { ToolExecutor } from "./assistantCore";

/**
 * Bridge to Hermes, the execution agent running locally on the same
 * device (Termux), not a remote/cloud service. NORAH Core never
 * assumes it can reach a phone's localhost from anywhere else — this
 * only works because, per the current deployment plan, NORAH Core
 * itself also runs locally in Termux, on the same loopback interface
 * as `hermes serve`.
 *
 * PROTOCOL: Hermes speaks JSON-RPC 2.0 over a WebSocket connection
 * (confirmed by the project owner), not a plain HTTP/OpenAI-style
 * endpoint — the previous version of this file POSTed JSON over HTTP
 * and expected a bespoke {ok, message} body, which does not match
 * Hermes's actual protocol and could never have worked against a real
 * Hermes instance. This file replaces that with a generic JSON-RPC-
 * over-WebSocket client.
 *
 * WHAT IS STILL UNCONFIRMED: the exact RPC method name(s) and params
 * shape Hermes exposes for a connectivity ping, and for any real
 * capability beyond a ping, have not been verified against Hermes's
 * own source/docs. HERMES_RPC_PING_METHOD below defaults to "ping" as
 * a common JSON-RPC convention, not a confirmed Hermes method — set
 * the env var to override it once the real method name is known.
 * Until then, expect connectivity_test to legitimately fail with a
 * "method not found"-style error from Hermes itself, which is a real,
 * honest signal (not a bug in this bridge) that the method name needs
 * correcting.
 *
 * No dependency was added: this uses the WebSocket implementation
 * built into Node 22 (Node's global `WebSocket`), not the "ws" npm
 * package.
 */

type JsonRpcResult = { ok: boolean; message: string; raw?: unknown };

const DEFAULT_TIMEOUT_MS = 8000;
const HERMES_RPC_PING_METHOD = process.env.HERMES_RPC_PING_METHOD?.trim() || "ping";

function callHermesRpc(method: string, params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonRpcResult> {
  return new Promise(resolve => {
    const hermesUrl = ENV.hermesUrl.trim();
    if (!hermesUrl) {
      resolve({ ok: false, message: "Hermes is not configured. Set HERMES_URL to Hermes's ws:// address (e.g. ws://127.0.0.1:9119/...) on the NORAH server." });
      return;
    }
    if (!/^wss?:\/\//i.test(hermesUrl)) {
      resolve({ ok: false, message: `HERMES_URL is set to "${hermesUrl}", which is not a ws:// or wss:// address. Hermes speaks JSON-RPC over WebSocket, so an http(s):// URL here will not connect.` });
      return;
    }

    const id = randomUUID();
    let socket: WebSocket;
    try {
      socket = new WebSocket(hermesUrl);
    } catch (error) {
      resolve({ ok: false, message: `Could not open a WebSocket to Hermes: ${error instanceof Error ? error.message : "unknown error"}` });
      return;
    }

    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, message: `Hermes did not respond within ${timeoutMs}ms. Confirm "hermes serve" is running and HERMES_URL points at the right host/port/path.` }), timeoutMs);

    function finish(result: JsonRpcResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closing/closed */ }
      resolve(result);
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });

    socket.addEventListener("message", event => {
      let parsed: { id?: string; result?: unknown; error?: { message?: string; code?: number } } | null = null;
      try {
        parsed = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return; // not a JSON-RPC frame for us — keep waiting for the real response, up to the timeout
      }
      if (!parsed || parsed.id !== id) return; // response to a different in-flight request, or an unsolicited push
      if (parsed.error) {
        finish({ ok: false, message: `Hermes RPC error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`, raw: parsed });
        return;
      }
      const result = parsed.result;
      finish({ ok: true, message: typeof result === "string" ? result : JSON.stringify(result), raw: parsed });
    });

    socket.addEventListener("error", () => {
      finish({ ok: false, message: "Hermes could not be reached over WebSocket. Confirm `hermes serve --port <port>` is running in Termux and HERMES_URL matches its ws:// address." });
    });

    socket.addEventListener("close", event => {
      if (!settled && event.code !== 1000) {
        finish({ ok: false, message: `Hermes closed the connection before responding (code ${event.code}).` });
      }
    });
  });
}

export const hermesToolExecutor: ToolExecutor = {
  async execute(toolId, input) {
    if (toolId !== "hermes-connectivity") {
      return { ok: false, message: `Hermes bridge does not support the "${toolId}" action yet — only "hermes-connectivity" is wired.` };
    }
    const result = await callHermesRpc(HERMES_RPC_PING_METHOD, { input });
    return { ok: result.ok, message: result.message };
  },
};
