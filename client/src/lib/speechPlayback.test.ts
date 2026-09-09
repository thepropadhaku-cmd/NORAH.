import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioFromBase64, normalizeSpeechForBrowser, speakWithBrowserFallback } from "./speechPlayback";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech playback fallback", () => {
  it("normalizes natural contractions without changing the chat text", () => {
    expect(normalizeSpeechForBrowser("I'm ready, I've got it, and I can't wait.")).toBe(
      "I am ready, I have got it, and I cannot wait.",
    );
  });

  it("creates a clear browser utterance and starts speech synthesis", () => {
    const speechSynthesis = { cancel: vi.fn(), speak: vi.fn() } as unknown as SpeechSynthesis;
    class MockUtterance {
      text: string;
      lang = "";
      rate = 0;
      pitch = 0;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const started = speakWithBrowserFallback("I'm Norah.", speechSynthesis);
    const utterance = speechSynthesis.speak.mock.calls[0]?.[0] as MockUtterance;

    expect(started).toBe(true);
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
    expect(utterance.text).toBe("I am Norah.");
    expect(utterance.lang).toBe("en-US");
    expect(utterance.rate).toBe(0.96);
  });

  it("creates browser audio from returned base64 and supports cleanup", () => {
    const AudioMock = vi.fn(function AudioMock(this: { src: string; play: ReturnType<typeof vi.fn> }, src: string) { this.src = src; this.play = vi.fn().mockResolvedValue(undefined); }) as unknown as typeof Audio;
    const createObjectURL = vi.fn().mockReturnValue("blob:norah-audio");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("Audio", AudioMock);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const result = createAudioFromBase64("SGVsbG8=", "audio/wav");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(result.url).toBe("blob:norah-audio");
    expect((result.audio as unknown as { src: string }).src).toBe("blob:norah-audio");
    result.cleanup();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:norah-audio");
  });

  it("returns false when browser speech is unavailable", () => {
    expect(speakWithBrowserFallback("Hello", undefined)).toBe(false);
  });
});
