export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const MALE = /male|\bguy\b|david|ravi|prabhat|madhur|daniel|fred|rishi|arthur|aaron|alex|george|charon|hindi india/i;
const FEMALE = /female|woman|zira|samantha|veena|heera|eva|susan|salli|victoria|fiona|lekha|neerja|google हिन्दी/i;

export function primeSpeechUnlock(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.resume();
    const primer = new SpeechSynthesisUtterance("\u200b");
    primer.volume = 0;
    primer.rate = 1;
    window.speechSynthesis.speak(primer);
  } catch {
    /* Android throws if speech is unavailable; the real read still tries */
  }
}

export function loadVoices(timeoutMs = 900): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const ready = synth.getVoices();
  if (ready.length) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish);
    try {
      synth.getVoices();
      synth.resume();
    } catch {
      /* getVoices can throw before the engine is ready */
    }
    window.setTimeout(finish, timeoutMs);
  });
}

function voiceScore(voice: SpeechSynthesisVoice, hindi: boolean): number {
  const blob = `${voice.lang} ${voice.name}`;
  let score = 0;
  if (hindi ? /^hi/i.test(voice.lang) : /^(en|hi)/i.test(voice.lang)) score += 4;
  if (MALE.test(blob) && !FEMALE.test(blob)) score += 3;
  if (voice.default) score += 1;
  if (voice.localService) score += 1;
  if (FEMALE.test(blob)) score -= 2;
  return score;
}

/** Prefer a male voice, but always return some voice so Android does not dead-end. */
export function chooseVoice(voices: SpeechSynthesisVoice[], sample: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const hindi = /[\u0900-\u097F]/.test(sample);
  return [...voices].sort((a, b) => voiceScore(b, hindi) - voiceScore(a, hindi))[0] ?? null;
}

export function pickMaleVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  return chooseVoice(speechSynthesis.getVoices(), "");
}

function speechChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= 180) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > 180) {
    let cut = rest.lastIndexOf(". ", 180);
    if (cut < 50) cut = rest.lastIndexOf(", ", 180);
    if (cut < 40) cut = rest.lastIndexOf(" ", 180);
    if (cut < 20) cut = 180;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.slice(0, 80);
}

export function speakOnDevice(text: string, voice: SpeechSynthesisVoice | null): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.reject(new Error("This phone has no speech engine."));
  }
  const pieces = speechChunks(text);
  if (!pieces.length) return Promise.resolve();
  const synth = window.speechSynthesis;
  const hindi = /[\u0900-\u097F]/.test(text);
  return new Promise((resolve, reject) => {
    let index = 0;
    let settled = false;
    let retriedBare = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    const speakPiece = (bare: boolean) => {
      const utterance = new SpeechSynthesisUtterance(pieces[index] ?? "");
      if (!bare && voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
      } else if (!bare && hindi) {
        utterance.lang = "hi-IN";
      }
      utterance.rate = 0.96;
      utterance.onend = () => {
        index += 1;
        if (index >= pieces.length) finish();
        else speakPiece(false);
      };
      utterance.onerror = (event) => {
        const code = event.error;
        if (code === "interrupted" || code === "canceled") {
          finish();
          return;
        }
        if (!retriedBare && (code === "synthesis-failed" || code === "voice-unavailable" || code === "language-unavailable" || code === "not-allowed" || code === "audio-busy")) {
          retriedBare = true;
          window.setTimeout(() => speakPiece(true), 60);
          return;
        }
        fail("This phone stopped the reading.");
      };
      try {
        synth.resume();
        synth.speak(utterance);
      } catch {
        fail("This phone stopped the reading.");
      }
    };
    speakPiece(false);
  });
}

