import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";
import type { ToolExecutor } from "./assistantCore";

/**
 * Bridge from NORAH Core to Hermes, the execution agent running on the
 * same device (Termux). Both run on the same loopback interface, so no
 * tunnel/relay is involved and nothing here assumes a remote server can
 * reach a phone's localhost.
 *
 * PROTOCOL — what is confirmed vs. applied from the public spec
 * ------------------------------------------------------------
 * CONFIRMED from the installed Hermes source (screenshots of
 * ~/.hermes/hermes-agent):
 *   - Hermes implements ACP, the Agent Client Protocol (JSON-RPC 2.0):
 *     agent/acp_adapter/server.py imports acp.schema types
 *     (InitializeResponse, AuthenticateResponse, NewSessionResponse,
 *     PromptResponse, ...) and implements on_connect(conn) and
 *     authenticate(method_id, **kwargs).
 *   - `hermes serve` (default 127.0.0.1:9119) is documented by its own
 *     --help as "the JSON-RPC/WebSocket gateway".
 *   - SECURITY.md: local-IPC surfaces (ACP) are trusted via OS-level
 *     access control / loopback-only binds, not a password.
 *
 * NOT READ FROM YOUR TERMINAL — applied from the public ACP spec, so
 * treat as unverified until a live run confirms them: the exact wire
 * method strings and param/result key names in ACP_METHOD and in the
 * request bodies below, and the shape of session/update notifications.
 * Every such literal is centralised here (env-overridable for the
 * method names) so a correction is a one-line change. A JSON-RPC
 * "method not found" / invalid-params error from Hermes is an honest
 * signal that one of them needs correcting, not a bridge bug; the
 * error text is passed back verbatim so it is visible.
 *
 * SECURITY: tool execution stays permission-gated by Hermes itself
 * (acp_adapter/permissions.py, edit_approval.py). This bridge never
 * auto-approves anything: if Hermes sends a request to us (which is how
 * ACP asks a client for permission), we answer with a JSON-RPC error
 * and report it, i.e. fail closed. Approval handling is deliberately
 * not implemented until its exact contract is verified.
 *
 * No dependency added: uses Node 22's built-in global WebSocket.
 */

const ACP_METHOD = {
  initialize: process.env.HERMES_ACP_METHOD_INITIALIZE?.trim() || "initialize",
  newSession: process.env.HERMES_ACP_METHOD_NEW_SESSION?.trim() || "session/new",
  prompt: process.env.HERMES_ACP_METHOD_PROMPT?.trim() || "session/prompt",
} as const;

const ACP_PROTOCOL_VERSION = 1; // UNCONFIRMED against installed acp package
const OVERALL_TIMEOUT_MS = 25000;

type BridgeResult = { ok: boolean; message: string };
type Rpc = (method: string, params: Record<string, unknown>) => Promise<any>;

function collectText(value: unknown, out: string[], depth = 0) {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) { value.forEach(v => collectText(v, out, depth + 1)); return; }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === "text" && typeof v === "string") out.push(v);
      else collectText(v, out, depth + 1);
    }
  }
}

/** Opens one WebSocket, runs `flow`, always closes. Never throws. */
function withHermesConnection(flow: (rpc: Rpc, notes: { text: string[]; declined: string[] }) => Promise<string>): Promise<BridgeResult> {
  return new Promise(resolve => {
    const hermesUrl = ENV.hermesUrl.trim();
    if (!hermesUrl) {
      resolve({ ok: false, message: "Hermes is not configured. Set HERMES_URL to Hermes's ws:// address (e.g. ws://127.0.0.1:9119) in the NORAH Core environment." });
      return;
    }
    if (!/^wss?:\/\//i.test(hermesUrl)) {
      resolve({ ok: false, message: `HERMES_URL is "${hermesUrl}", which is not ws:// or wss://. Hermes serves JSON-RPC over WebSocket.` });
      return;
    }

    let socket: WebSocket;
    try { socket = new WebSocket(hermesUrl); }
    catch (error) {
      resolve({ ok: false, message: `Could not open a WebSocket to Hermes: ${error instanceof Error ? error.message : "unknown error"}` });
      return;
    }

    const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const notes = { text: [] as string[], declined: [] as string[] };
    let settled = false;

    const finish = (result: BridgeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      pending.forEach(p => p.reject(new Error("connection closed")));
      pending.clear();
      try { socket.close(); } catch { /* already closed */ }
      resolve(result);
    };
    const deadline = setTimeout(() => finish({ ok: false, message: `Hermes did not complete within ${OVERALL_TIMEOUT_MS / 1000}s. Confirm "hermes serve" is running and HERMES_URL is correct.` }), OVERALL_TIMEOUT_MS);

    const rpc: Rpc = (method, params) => new Promise((res, rej) => {
      const id = randomUUID();
      pending.set(id, { resolve: res, reject: rej });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });

    socket.addEventListener("open", () => {
      flow(rpc, notes)
        .then(message => finish({ ok: true, message }))
        .catch(error => finish({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    });

    socket.addEventListener("message", event => {
      let msg: any;
      try { msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      // Response to one of our requests.
      if (msg.id != null && pending.has(msg.id) && msg.method === undefined) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`Hermes RPC error${msg.error.code != null ? ` (${msg.error.code})` : ""}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
        return;
      }
      // Server-initiated request (has id + method): ACP uses these for
      // permission prompts. Fail closed — never auto-approve.
      if (msg.id != null && typeof msg.method === "string") {
        notes.declined.push(msg.method);
        try { socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `NORAH bridge does not handle server-initiated "${msg.method}"; declined.` } })); } catch { /* socket closing */ }
        return;
      }
      // Notification (method, no id): collect streamed text from session updates.
      if (typeof msg.method === "string" && /update/i.test(msg.method)) collectText(msg.params, notes.text);
    });

    socket.addEventListener("error", () => finish({ ok: false, message: "Hermes could not be reached over WebSocket. Confirm `hermes serve --port <port>` is running in Termux and HERMES_URL matches it." }));
    socket.addEventListener("close", event => {
      if (!settled) finish({ ok: false, message: `Hermes closed the connection before finishing (code ${event.code}).` });
    });
  });
}

async function initialize(rpc: Rpc) {
  return rpc(ACP_METHOD.initialize, { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} });
}

/** Connectivity check: a real ACP `initialize` handshake, nothing more. */
function pingHermes(): Promise<BridgeResult> {
  return withHermesConnection(async rpc => {
    const result = await initialize(rpc);
    const name = result?.agentInfo?.name ?? result?.agent?.name;
    return `Hermes completed an ACP initialize handshake${name ? ` (${name})` : ""}.`;
  });
}

/** One conversational turn through Hermes: initialize → session/new → session/prompt. */
function promptHermes(promptText: string): Promise<BridgeResult> {
  return withHermesConnection(async (rpc, notes) => {
    const init = await initialize(rpc);
    const authMethods = Array.isArray(init?.authMethods) ? init.authMethods.map((m: any) => m?.id ?? String(m)) : [];
    let sessionId: string | undefined;
    try {
      const session = await rpc(ACP_METHOD.newSession, { cwd: process.cwd(), mcpServers: [] });
      sessionId = session?.sessionId ?? session?.session_id;
    } catch (error) {
      const hint = authMethods.length ? ` Hermes advertised auth methods [${authMethods.join(", ")}]; authenticate is not wired in this bridge.` : "";
      throw new Error(`${error instanceof Error ? error.message : String(error)}${hint}`);
    }
    if (!sessionId) throw new Error("Hermes did not return a session id from session/new.");

    const result = await rpc(ACP_METHOD.prompt, { sessionId, prompt: [{ type: "text", text: promptText }] });
    let reply = notes.text.join("").trim();
    if (!reply) {
      const fallback: string[] = [];
      collectText(result, fallback);
      reply = fallback.join("").trim() || `Hermes finished (${JSON.stringify(result)}) without returning text.`;
    }
    if (notes.declined.length) reply += `\n\n(Hermes asked for approval via ${[...new Set(notes.declined)].join(", ")}; NORAH declined because approval handling is not wired yet.)`;
    return reply;
  });
}

export const hermesToolExecutor: ToolExecutor = {
  async execute(toolId, input) {
    if (toolId === "hermes-connectivity") return pingHermes();
    if (toolId === "hermes-prompt") {
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (!prompt) return { ok: false, message: "Nothing to send to Hermes — the message had no request after the trigger phrase." };
      return promptHermes(prompt);
    }
    return { ok: false, message: `Hermes bridge does not support the "${toolId}" action.` };
  },
};
