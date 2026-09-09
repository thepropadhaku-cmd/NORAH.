import { createAudioFromBase64, speakWithBrowserFallback } from "./speechPlayback";

export type SpeechStatus = "idle" | "loading" | "speaking" | "fallback" | "error";
export type SpeechResponse = {
  available: boolean;
  audioContent: string | null;
  mimeType: string | null;
  normalizedText: string;
};

export function createAssistantSpeechController(
  requestSpeech: (text: string) => Promise<SpeechResponse>,
  speechSynthesis: SpeechSynthesis | undefined,
  onStatus: (status: SpeechStatus) => void,
) {
  let audio: HTMLAudioElement | null = null;
  let cleanupAudio: (() => void) | null = null;

  const stop = () => {
    audio?.pause();
    audio = null;
    cleanupAudio?.();
    cleanupAudio = null;
    speechSynthesis?.cancel();
    onStatus("idle");
  };

  const fallback = (text: string) => {
    const started = speakWithBrowserFallback(text, speechSynthesis, () => onStatus("idle"), () => onStatus("idle"));
    onStatus(started ? "fallback" : "error");
    return started;
  };

  const speak = async (text: string) => {
    stop();
    onStatus("loading");
    try {
      const response = await requestSpeech(text);
      if (!response.available || !response.audioContent) {
        fallback(response.normalizedText || text);
        return;
      }
      const created = createAudioFromBase64(response.audioContent, response.mimeType || "audio/wav");
      audio = created.audio;
      cleanupAudio = created.cleanup;
      audio.onended = () => { created.cleanup(); audio = null; cleanupAudio = null; onStatus("idle"); };
      audio.onerror = () => {
        created.cleanup();
        audio = null;
        cleanupAudio = null;
        fallback(response.normalizedText || text);
      };
      await audio.play();
      onStatus("speaking");
    } catch {
      fallback(text);
    }
  };

  return { speak, stop };
}
