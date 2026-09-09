export function normalizeSpeechForBrowser(text: string): string {
  return text
    .replace(/\bI'm\b/gi, "I am")
    .replace(/\bI've\b/gi, "I have")
    .replace(/\bI'll\b/gi, "I will")
    .replace(/\bI'd\b/gi, "I would")
    .replace(/\byou're\b/gi, "you are")
    .replace(/\byou've\b/gi, "you have")
    .replace(/\byou'll\b/gi, "you will")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bdoesn't\b/gi, "does not")
    .replace(/\bisn't\b/gi, "is not")
    .replace(/\baren't\b/gi, "are not")
    .replace(/\bit's\b/gi, "it is")
    .replace(/\bthat's\b/gi, "that is")
    .replace(/\bwhat's\b/gi, "what is")
    .replace(/\bthere's\b/gi, "there is")
    .replace(/\s+/g, " ")
    .trim();
}

export function createAudioFromBase64(base64Audio: string, mimeType = "audio/wav"): { audio: HTMLAudioElement; url: string; cleanup: () => void } {
  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Audio(url);
  return { audio, url, cleanup: () => URL.revokeObjectURL(url) };
}

export function speakWithBrowserFallback(
  text: string,
  speechSynthesis: SpeechSynthesis | undefined,
  onEnd?: () => void,
  onError?: () => void,
): boolean {
  if (!speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return false;
  const utterance = new SpeechSynthesisUtterance(normalizeSpeechForBrowser(text));
  utterance.lang = "en-US";
  utterance.rate = 0.96;
  utterance.pitch = 0.96;
  utterance.onend = onEnd || null;
  utterance.onerror = onError || null;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  return true;
}
