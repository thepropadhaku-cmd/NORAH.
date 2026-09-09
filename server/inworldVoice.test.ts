import { describe, expect, it } from "vitest";

describe("Inworld voice configuration", () => {
  it("authenticates and resolves the configured Norah voice", async () => {
    const apiKey = process.env.INWORLD_API_KEY;
    const voiceId = process.env.INWORLD_VOICE_ID;

    expect(apiKey).toBeTruthy();
    expect(voiceId).toBeTruthy();

    const response = await fetch("https://api.inworld.ai/voices/v1/voices?pageSize=2000", {
      headers: { Authorization: `Basic ${apiKey as string}` },
    });

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      voices?: Array<{ voiceId?: string; displayName?: string; source?: string }>;
    };
    const configuredVoice = body.voices?.find((voice) => voice.voiceId === voiceId);

    expect(configuredVoice).toBeDefined();
  }, 15_000);
});
