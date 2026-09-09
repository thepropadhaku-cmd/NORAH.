import { ENV } from "./_core/env";

const INWORLD_TTS_URL = "https://api.inworld.ai/tts/v1/voice";
const MAX_TTS_CHARACTERS = 2000;

const contractionReplacements: Array<[RegExp, string]> = [
  [/\bI'm\b/gi, "I am"],
  [/\bI've\b/gi, "I have"],
  [/\bI'll\b/gi, "I will"],
  [/\bI'd\b/gi, "I would"],
  [/\byou're\b/gi, "you are"],
  [/\byou've\b/gi, "you have"],
  [/\byou'll\b/gi, "you will"],
  [/\byou'd\b/gi, "you would"],
  [/\bhe's\b/gi, "he is"],
  [/\bshe's\b/gi, "she is"],
  [/\bwe're\b/gi, "we are"],
  [/\bwe've\b/gi, "we have"],
  [/\bwe'll\b/gi, "we will"],
  [/\bthey're\b/gi, "they are"],
  [/\bthey've\b/gi, "they have"],
  [/\bthey'll\b/gi, "they will"],
  [/\bit's\b/gi, "it is"],
  [/\bthat's\b/gi, "that is"],
  [/\bthere's\b/gi, "there is"],
  [/\bwhat's\b/gi, "what is"],
  [/\bwho's\b/gi, "who is"],
  [/\bcan't\b/gi, "cannot"],
  [/\bwon't\b/gi, "will not"],
  [/\bdon't\b/gi, "do not"],
  [/\bdoesn't\b/gi, "does not"],
  [/\bdidn't\b/gi, "did not"],
  [/\bisn't\b/gi, "is not"],
  [/\baren't\b/gi, "are not"],
  [/\bwasn't\b/gi, "was not"],
  [/\bweren't\b/gi, "were not"],
  [/\bhaven't\b/gi, "have not"],
  [/\bhasn't\b/gi, "has not"],
  [/\bhadn't\b/gi, "had not"],
  [/\bshouldn't\b/gi, "should not"],
  [/\bcouldn't\b/gi, "could not"],
  [/\bwouldn't\b/gi, "would not"],
  [/\bmustn't\b/gi, "must not"],
];

export function normalizeSpeechText(text: string): string {
  return contractionReplacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text).replace(/\s+/g, " ").trim();
}

export type InworldSpeechResult = {
  audioContent: string;
  mimeType: "audio/wav";
  normalizedText: string;
  modelId: string;
};

export class InworldTtsError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "InworldTtsError";
  }
}

export async function synthesizeInworldSpeech(text: string): Promise<InworldSpeechResult> {
  const normalizedText = normalizeSpeechText(text);
  if (!normalizedText) throw new InworldTtsError("There is no assistant text to speak.");
  if (normalizedText.length > MAX_TTS_CHARACTERS) throw new InworldTtsError("This response is too long to speak in one pass.");
  if (!ENV.inworldApiKey || !ENV.inworldVoiceId) throw new InworldTtsError("Inworld voice configuration is unavailable.");

  const response = await fetch(INWORLD_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${ENV.inworldApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: normalizedText,
      voiceId: ENV.inworldVoiceId,
      modelId: "inworld-tts-2",
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 22050 },
      deliveryMode: "BALANCED",
      applyTextNormalization: "ON",
    }),
  });

  if (!response.ok) {
    let detail = "Inworld speech generation failed.";
    try {
      const errorBody = (await response.json()) as { message?: string; error?: { message?: string } };
      detail = errorBody.message || errorBody.error?.message || detail;
    } catch { /* Keep the safe generic message. */ }
    throw new InworldTtsError(detail, response.status);
  }

  const body = (await response.json()) as { audioContent?: string; usage?: { modelId?: string } };
  if (!body.audioContent) throw new InworldTtsError("Inworld returned no audio data.");

  return { audioContent: body.audioContent, mimeType: "audio/wav", normalizedText, modelId: body.usage?.modelId || "inworld-tts-2" };
}
