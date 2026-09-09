import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantSpeechController } from "./assistantSpeechController";

afterEach(() => vi.unstubAllGlobals());

describe("assistant speech controller", () => {
  it("falls back to browser speech when the provider returns unavailable", async () => {
    const speechSynthesis = { cancel: vi.fn(), speak: vi.fn() } as unknown as SpeechSynthesis;
    const utterances: Array<{ text: string }> = [];
    class MockUtterance {
      constructor(public text: string) { utterances.push(this); }
      lang = "";
      rate = 0;
      pitch = 0;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    const statuses: string[] = [];
    const controller = createAssistantSpeechController(
      async () => ({ available: false, audioContent: null, mimeType: null, normalizedText: "I am here." }),
      speechSynthesis,
      status => statuses.push(status),
    );

    await controller.speak("I'm here.");

    expect(utterances[0]?.text).toBe("I am here.");
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(statuses).toEqual(["idle", "loading", "fallback"]);
  });

  it("reports an error when both Inworld and browser speech are unavailable", async () => {
    const statuses: string[] = [];
    const controller = createAssistantSpeechController(
      async () => ({ available: false, audioContent: null, mimeType: null, normalizedText: "Hello." }),
      undefined,
      status => statuses.push(status),
    );

    await controller.speak("Hello.");

    expect(statuses).toEqual(["idle", "loading", "error"]);
  });
});
