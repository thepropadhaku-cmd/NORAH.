import { describe, expect, it } from "vitest";
import { synthesizeInworldSpeech } from "./inworldTts";

describe("live Inworld Norah TTS", () => {
  it.skipIf(process.env.RUN_LIVE_TTS !== "1")("generates audio for a normal and longer assistant response", async () => {
    const normal = await synthesizeInworldSpeech("I am Norah. I have taken care of that for you.");
    const longer = await synthesizeInworldSpeech(
      "I am Norah. I have taken care of that for you. I will explain the result clearly, then give you the next useful step. If anything is uncertain, I will say so rather than pretending it is complete.",
    );

    expect(normal.mimeType).toBe("audio/wav");
    expect(normal.audioContent.length).toBeGreaterThan(100);
    expect(longer.audioContent.length).toBeGreaterThan(normal.audioContent.length);
  }, 30_000);
});
