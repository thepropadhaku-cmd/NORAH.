import { describe, expect, it } from "vitest";

describe("ElevenLabs configuration", () => {
  it.skip("accepts the configured server-side credential when ElevenLabs is the active provider", async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey as string },
    });

    expect(response.ok).toBe(true);
  }, 15_000);
});
