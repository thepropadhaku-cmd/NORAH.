import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { synthesizeInworldSpeech } from "./inworldTts";

vi.mock("./inworldTts", () => ({
  InworldTtsError: class InworldTtsError extends Error {},
  normalizeSpeechText: (text: string) => text.replace(/\bI'm\b/gi, "I am"),
  synthesizeInworldSpeech: vi.fn(),
}));

const speechMock = vi.mocked(synthesizeInworldSpeech);
const baseContext = (): TrpcContext => ({ user: undefined, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });

describe("assistant response to speech contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a safe text-only response when the provider fails", async () => {
    speechMock.mockRejectedValue(new Error("provider unavailable"));
    const caller = appRouter.createCaller(baseContext());

    const spoken = await caller.assistant.speak({ text: "I'm still here." });

    expect(spoken).toMatchObject({ available: false, audioContent: null, normalizedText: "I am still here." });
    expect(spoken.error).toBe("Norah’s voice is unavailable right now.");
  });

  it("passes a normal assistant response to the server-side voice boundary", async () => {
    speechMock.mockResolvedValue({ audioContent: "UklGR-audio", mimeType: "audio/wav", normalizedText: "I am ready.", modelId: "inworld-tts-2" });
    const caller = appRouter.createCaller(baseContext());
    const assistantResponse = "I'm ready.";

    const spoken = await caller.assistant.speak({ text: assistantResponse });

    expect(speechMock).toHaveBeenCalledWith(assistantResponse);
    expect(spoken).toMatchObject({ available: true, audioContent: "UklGR-audio", mimeType: "audio/wav" });
  });
});
