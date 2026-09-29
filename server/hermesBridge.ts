import { spawn } from "node:child_process";
import { ENV } from "./_core/env";
import type { ToolExecutor } from "./assistantCore";

/**
 * Bridge from NORAH Core to Hermes over ACP (Agent Client Protocol,
 * JSON-RPC 2.0) using a local child process: `hermes acp`, speaking
 * newline-delimited JSON on stdin/stdout. Both run as the same OS user on
 * the same device (Termux), which is the trust boundary Hermes's own
 * SECURITY.md defines for ACP ("local-IPC surfaces": OS-level access
 * control, no network exposure). No port, token, tunnel or relay involved.
 *
 * WHY NOT ws://127.0.0.1:9119: the previous WebSocket version assumed the
 * `hermes serve` gateway speaks ACP. The evidence does not support that.
 * `hermes serve` is the dashboard/desktop gateway (its root page injects a
 * session token for its own web UI, and the WebSocket route/handshake was
 * never located), whereas acp_adapter/entry.py documents ACP as
 * `hermes acp`. The gateway's protocol is unconfirmed, so it is not used.
 *
 * CONFIRMED from the installed acp package (terminal output):
 *   - agent methods: initialize, authenticate, session/new, session/prompt,
 *     session/cancel, session/load, ... ; client methods: session/update,
 *     session/request_permission, fs/*, terminal/*; PROTOCOL_VERSION = 1
 *   - request/response field names (camelCase aliases): InitializeRequest
 *     {protocolVersion, clientCapabilities, clientInfo}; NewSessionRequest
 *     {cwd, mcpServers}; NewSessionResponse {sessionId}; PromptRequest
 *     {sessionId, prompt}; PromptResponse {stopReason}
 *
 * NOT CONFIRMED against a live Hermes (taken from the public ACP spec):
 *   - `hermes acp` uses newline-delimited JSON framing on stdio
 *   - the session/update payload discriminator ("sessionUpdate":
 *     "agent_message_chunk" | "tool_call" | "tool_call_update")
 *   - the shape of a permission request/response (options[].kind,
 *     outcome: {outcome:"selected", optionId} | {outcome:"cancelled"})
 * If a real run shows a mismatch, the error text is returned verbatim.
 *
 * PERMISSIONS (fail closed): Hermes gates its own tools and asks the client
 * via session/request_permission. This bridge answers that request only
 * under a narrow policy: a one-time "allow_once" is selected ONLY when the
 * tool's kind is in HERMES_APPROVE_KINDS (default empty = approve nothing)
 * AND is one of the read-only kinds hard-coded below. Everything else is
 * rejected. "allow_always" is never selected. fs/* and terminal/* client
 * requests, and any unknown server request, are refused, and no client
 * capabilities are advertised. Every decision is reported in the reply.
 */

const ACP_PROTOCOL_VERSION = 1;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const PROMPT_TIMEOUT_MS = 90_000; // an agent turn (model + tools) takes far longer than a handshake
const APPROVABLE_KINDS = new Set(["read", "search"]); // hard ceiling, regardless of config

type BridgeResult = { ok: boolean; message: string };
type Rpc = (method: string, params: Record<string, unknown>) => Promise<any>;
type Notes = { text: string[]; permissions: string[]; tools: Map<string, string>; refused: string[] };

function approvedKinds(): Set<string> {
  const configured = ENV.hermesApproveKinds.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
  return new Set(configured.filter(k => APPROVABLE_KINDS.has(k)));
}

function decidePermission(params: any, notes: Notes) {
  const kind = String(params?.toolCall?.kind ?? "other").toLowerCase();
  const title = String(params?.toolCall?.title ?? params?.toolCall?.toolCallId ?? "an action");
  const options: any[] = Array.isArray(params?.options) ? params.options : [];
  const allowOnce = options.find(o => o?.kind === "allow_once" && o?.optionId);
  if (approvedKinds().has(kind) && allowOnce) {
    notes.permissions.push(`approved once: ${title} (${kind})`);
    return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
  }
  const reject = options.find(o => o?.kind === "reject_once" && o?.optionId);
  notes.permissions.push(`declined: ${title} (${kind})`);
  return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
}

function withHermesProcess(flow: (rpc: Rpc, notes: Notes) => Promise<string>, timeoutMs: number): Promise<BridgeResult> {
  return new Promise(resolve => {
    const [command, ...args] = ENV.hermesAcpCommand.trim().split(/\s+/).filter(Boolean);
    if (!command) {
      resolve({ ok: false, message: "Hermes is not configured. Set HERMES_ACP_COMMAND (default: \"hermes acp\") in the NORAH Core environment." });
      return;
    }

    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }); // no shell: fixed argv only
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const notes: Notes = { text: [], permissions: [], tools: new Map(), refused: [] };
    let nextId = 1;
    let settled = false;
    let stderrTail = "";

    const finish = (result: BridgeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      pending.forEach(p => p.reject(new Error("Hermes connection closed")));
      pending.clear();
      try { child.stdin.end(); } catch { /* already closed */ }
      try { child.kill(); } catch { /* already exited */ }
      resolve(result);
    };
    const deadline = setTimeout(() => finish({ ok: false, message: `Hermes did not complete within ${timeoutMs / 1000}s.${stderrTail ? ` Last stderr: ${stderrTail.trim()}` : ""}` }), timeoutMs);

    const write = (obj: unknown) => { try { child.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* process gone; exit handler reports */ } };
    const rpc: Rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      write({ jsonrpc: "2.0", id, method, params });
    });

    const handle = (line: string) => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; } // non-JSON line (e.g. a startup warning): ignore
      if (!msg || typeof msg !== "object") return;

      if (msg.id != null && msg.method === undefined && pending.has(msg.id)) { // response to us
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`Hermes RPC error${msg.error.code != null ? ` (${msg.error.code})` : ""}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.id != null && typeof msg.method === "string") { // request from Hermes to us
        if (msg.method === "session/request_permission") {
          write({ jsonrpc: "2.0", id: msg.id, result: decidePermission(msg.params, notes) });
        } else {
          notes.refused.push(msg.method);
          write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `NORAH does not provide "${msg.method}".` } });
        }
        return;
      }
      if (msg.method === "session/update") { // notification
        const update = msg.params?.update ?? {};
        const type = update.sessionUpdate;
        if (type === undefined || type === "agent_message_chunk") {
          if (typeof update.content?.text === "string") notes.text.push(update.content.text);
        } else if (type === "tool_call" || type === "tool_call_update") {
          const id = String(update.toolCallId ?? "tool");
          const prev = notes.tools.get(id);
          const title = update.title ?? prev?.split(": ")[0] ?? id;
          notes.tools.set(id, `${title}: ${update.status ?? prev?.split(": ")[1] ?? "unknown"}`);
        }
      }
    };

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) handle(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderrTail = (stderrTail + chunk).slice(-500); });
    child.on("error", error => finish({ ok: false, message: `Could not start "${ENV.hermesAcpCommand}": ${error.message}. Is Hermes installed and on PATH for the NORAH Core process?` }));
    child.on("exit", code => finish({ ok: false, message: `Hermes exited (code ${code}) before finishing.${stderrTail ? ` Last stderr: ${stderrTail.trim()}` : ""}` }));

    flow(rpc, notes)
      .then(message => finish({ ok: true, message }))
      .catch(error => finish({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  });
}

function initialize(rpc: Rpc) {
  // No fs/terminal client capabilities are advertised: Hermes uses its own tools.
  return rpc("initialize", { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: "norah-core", version: "0.1" } });
}

/** Connectivity check: a real ACP initialize handshake with a freshly started `hermes acp`. */
function pingHermes(): Promise<BridgeResult> {
  return withHermesProcess(async rpc => {
    const result = await initialize(rpc);
    const name = result?.agentInfo?.name;
    return `Hermes completed an ACP initialize handshake${name ? ` (${name})` : ""}.`;
  }, HANDSHAKE_TIMEOUT_MS);
}

/** One turn through Hermes: initialize -> session/new -> session/prompt. */
function promptHermes(promptText: string): Promise<BridgeResult> {
  return withHermesProcess(async (rpc, notes) => {
    const init = await initialize(rpc);
    const authMethods = Array.isArray(init?.authMethods) ? init.authMethods.map((m: any) => m?.id ?? String(m)) : [];
    let sessionId: string | undefined;
    try {
      sessionId = (await rpc("session/new", { cwd: process.cwd(), mcpServers: [] }))?.sessionId;
    } catch (error) {
      const hint = authMethods.length ? ` Hermes advertised auth methods [${authMethods.join(", ")}]; authenticate is not wired in this bridge.` : "";
      throw new Error(`${error instanceof Error ? error.message : String(error)}${hint}`);
    }
    if (!sessionId) throw new Error("Hermes did not return a sessionId from session/new.");

    const result = await rpc("session/prompt", { sessionId, prompt: [{ type: "text", text: promptText }] });
    let reply = notes.text.join("").trim() || `Hermes finished (stop reason: ${result?.stopReason ?? "unknown"}) without returning text.`;
    const activity = [...notes.permissions, ...notes.tools.values(), ...[...new Set(notes.refused)].map(m => `refused ${m}`)];
    if (activity.length) reply += `\n\n[Hermes activity: ${activity.join("; ")}]`;
    return reply;
  }, PROMPT_TIMEOUT_MS);
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
