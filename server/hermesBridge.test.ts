import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import { createAssistantReply } from "./assistantCore";
import { hermesToolExecutor } from "./hermesBridge";

type Handler = (event: any) => void;

/**
 * Minimal in-memory stand-in for Node's global WebSocket, acting as a fake
 * Hermes ACP server. It proves the bridge's protocol behaviour (call order,
 * streamed-text collection, fail-closed approvals). It does NOT prove that
 * real Hermes accepts these method names/params — that needs a live run.
 */
function installFakeHermes(script: (msg: any, reply: (m: unknown) => void) => void) {
  const received: any[] = [];
  class FakeWebSocket {
    private handlers: Record<string, Handler[]> = {};
    constructor(public url: string) {
      setTimeout(() => this.emit("open", {}), 0);
    }
    addEventListener(type: string, handler: Handler) {
      (this.handlers[type] ??= []).push(handler);
    }
    private emit(type: string, event: unknown) {
      (this.handlers[type] ?? []).forEach(h => h(event));
    }
    send(raw: string) {
      const msg = JSON.parse(raw);
      received.push(msg);
      script(msg, m => setTimeout(() => this.emit("message", { data: JSON.stringify(m) }), 0));
    }
    close() {
      this.emit("close", { code: 1000 });
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return received;
}

describe("Hermes bridge", () => {
  afterEach(() => {
    ENV.hermesUrl = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects an http:// HERMES_URL with a clear error", async () => {
    ENV.hermesUrl = "http://127.0.0.1:9119";
    const result = await hermesToolExecutor.execute("hermes-connectivity", { query: "test hermes" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ws://");
  });

  it("connectivity check performs an ACP initialize handshake", async () => {
    ENV.hermesUrl = "ws://127.0.0.1:9119";
    const received = installFakeHermes((msg, reply) => {
      if (msg.method === "initialize") reply({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "hermes" }, authMethods: [] } });
    });

    const result = await hermesToolExecutor.execute("hermes-connectivity", { query: "Test Hermes connectivity" });

    expect(received.map(m => m.method)).toEqual(["initialize"]);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("initialize handshake");
  });

  it("hermes-prompt runs initialize -> session/new -> session/prompt and returns streamed text", async () => {
    ENV.hermesUrl = "ws://127.0.0.1:9119";
    const received = installFakeHermes((msg, reply) => {
      if (msg.method === "initialize") reply({ jsonrpc: "2.0", id: msg.id, result: { authMethods: [] } });
      if (msg.method === "session/new") reply({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
      if (msg.method === "session/prompt") {
        reply({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { content: { type: "text", text: "pong" } } } });
        reply({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      }
    });

    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "say pong" });

    expect(received.map(m => m.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(received[2].params).toEqual({ sessionId: "s1", prompt: [{ type: "text", text: "say pong" }] });
    expect(result).toEqual({ ok: true, message: "pong" });
  });

  it("fails closed: a server-initiated approval request is declined, never approved", async () => {
    ENV.hermesUrl = "ws://127.0.0.1:9119";
    const received = installFakeHermes((msg, reply) => {
      if (msg.method === "initialize") reply({ jsonrpc: "2.0", id: msg.id, result: {} });
      if (msg.method === "session/new") reply({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
      if (msg.method === "session/prompt") {
        reply({ jsonrpc: "2.0", id: "perm-1", method: "session/request_permission", params: {} });
        reply({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      }
    });

    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "do something risky" });

    const permissionReply = received.find(m => m.id === "perm-1");
    expect(permissionReply?.error).toBeDefined();
    expect(permissionReply?.result).toBeUndefined();
    expect(result.message).toContain("declined");
  });

  it("refuses to send an empty hermes-prompt", async () => {
    ENV.hermesUrl = "ws://127.0.0.1:9119";
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "   " });
    expect(result.ok).toBe(false);
  });

  it("returns the Hermes result to the assistant flow", async () => {
    const result = await createAssistantReply(
      "Test Hermes connectivity",
      [],
      [],
      { execute: async () => ({ ok: true, message: "Hermes connectivity confirmed." }) },
    );

    expect(result.content).toContain("Hermes connectivity confirmed.");
  });

  it("routes 'ask Hermes to ...' to hermes-prompt with the trigger stripped", async () => {
    const execute = vi.fn(async () => ({ ok: true, message: "done" }));
    await createAssistantReply("Ask Hermes to say pong", [], [], { execute });
    expect(execute).toHaveBeenCalledWith("hermes-prompt", { query: "Ask Hermes to say pong", prompt: "say pong" });
  });
});
