import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSpeechText, synthesizeInworldSpeech } from "./inworldTts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Inworld TTS service", () => {
  it("expands common contractions for clearer spoken delivery", () => {
    expect(normalizeSpeechText("I'm ready. I've got it, but I can't do that if it's late.")).toBe(
      "I am ready. I have got it, but I cannot do that if it is late.",
    );
  });

  it("returns the provider audio and sends the configured voice server-side", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ audioContent: "UklGRk...", usage: { modelId: "inworld-tts-2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeInworldSpeech("I'm Norah. I'll help you.");
    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { text: string; voiceId: string };

    expect(result.audioContent).toBe("UklGRk...");
    expect(result.mimeType).toBe("audio/wav");
    expect(result.normalizedText).toBe("I am Norah. I will help you.");
    expect(requestBody.text).toBe("I am Norah. I will help you.");
    expect(requestBody.voiceId).toBeTruthy();
  });

  it("turns provider failures into a typed service error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "temporarily unavailable" }), { status: 503 })));

    await expect(synthesizeInworldSpeech("Please speak this.")).rejects.toMatchObject({ status: 503, message: "temporarily unavailable" });
  });
});
