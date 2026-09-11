import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import { createAssistantReply } from "./assistantCore";
import { hermesToolExecutor } from "./hermesBridge";

describe("Hermes bridge", () => {
  afterEach(() => {
    ENV.hermesUrl = "";
    vi.restoreAllMocks();
  });

  it("round-trips the harmless connectivity test through Hermes", async () => {
    ENV.hermesUrl = "http://hermes.test/execute";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, message: "Hermes connectivity confirmed." }), { status: 200 }));

    const result = await hermesToolExecutor.execute("hermes-connectivity", { query: "Test Hermes connectivity" });

    expect(fetchMock).toHaveBeenCalledWith(ENV.hermesUrl, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "connectivity_test", input: { query: "Test Hermes connectivity" } }),
    }));
    expect(result).toEqual({ ok: true, message: "Hermes connectivity confirmed." });
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
});