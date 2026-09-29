import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import { createAssistantReply } from "./assistantCore";
import { hermesToolExecutor } from "./hermesBridge";

/**
 * These tests spawn a real child process (server/hermesBridge.fixtures/*)
 * speaking newline-delimited JSON-RPC over stdio, exercising the real
 * bridge's framing, permission policy, and error handling end to end.
 * They prove the bridge's own logic is correct. They do NOT prove real
 * Hermes accepts the same method names/params — only a live run against
 * the installed `hermes acp` can confirm that.
 */
const fixturesDir = path.dirname(fileURLToPath(import.meta.url)) + "/hermesBridge.fixtures";
const fakeAgent = `${process.execPath} ${fixturesDir}/fakeAcpAgent.mjs`;
const fakeExitAgent = `${process.execPath} ${fixturesDir}/fakeExitAgent.mjs`;

describe("Hermes bridge", () => {
  afterEach(() => {
    ENV.hermesAcpCommand = "hermes acp";
    ENV.hermesApproveKinds = "";
  });

  it("connectivity check performs an ACP initialize handshake", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    const result = await hermesToolExecutor.execute("hermes-connectivity", {});
    expect(result).toEqual({ ok: true, message: "Hermes completed an ACP initialize handshake (fake-hermes)." });
  }, 10000);

  it("hermes-prompt runs initialize -> session/new -> session/prompt and returns streamed text, ignoring non-JSON stdout lines", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "say pong" });
    expect(result).toEqual({ ok: true, message: "pong" });
  }, 10000);

  it("fails closed by default: a read-tool permission request is declined when nothing is approved", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    ENV.hermesApproveKinds = "";
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "read the file" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("permission denied");
    expect(result.message).toContain("declined: Read file (read)");
    expect(result.message).not.toContain("nonce-42");
  }, 10000);

  it("approves a read permission exactly once (never allow_always) when HERMES_APPROVE_KINDS=read", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    ENV.hermesApproveKinds = "read";
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "read the file" });
    expect(result.message).toContain("contents: nonce-42");
    expect(result.message).toContain("approved once: Read file (read)");
    expect(result.message).toContain("Read file: completed");
  }, 10000);

  it("keeps an 'edit' tool declined even if configured — only read/search are ever honored", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    ENV.hermesApproveKinds = "edit,execute";
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "edit the file" });
    expect(result.message).toContain("permission denied");
    expect(result.message).toContain("declined: Read file (edit)");
  }, 10000);

  it("refuses server-initiated fs/* requests (no client capabilities are granted)", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    ENV.hermesApproveKinds = "read";
    const result = await hermesToolExecutor.execute("hermes-prompt", { prompt: "fs please" });
    expect(result.message).toContain("fs answer: refused");
    expect(result.message).toContain("refused fs/read_text_file");
  }, 10000);

  it("reports a clear error when the configured command does not exist", async () => {
    ENV.hermesAcpCommand = "definitely-not-a-real-command acp";
    const result = await hermesToolExecutor.execute("hermes-connectivity", {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not start");
  }, 10000);

  it("surfaces the stderr tail when the process exits before finishing", async () => {
    ENV.hermesAcpCommand = fakeExitAgent;
    const result = await hermesToolExecutor.execute("hermes-connectivity", {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("exited (code 3)");
    expect(result.message).toContain("boom: not logged in");
  }, 10000);

  it("refuses an empty hermes-prompt and an unsupported tool id without spawning anything", async () => {
    ENV.hermesAcpCommand = fakeAgent;
    expect((await hermesToolExecutor.execute("hermes-prompt", { prompt: "   " })).ok).toBe(false);
    expect((await hermesToolExecutor.execute("shell", {})).ok).toBe(false);
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
