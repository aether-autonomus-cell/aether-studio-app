/** Picture timing is saved once. A longer line may extend that panel only. */

export function panelHold(saved: number | undefined, audioSec: number): number {
  const audio = Math.max(1.2, Number.isFinite(audioSec) ? audioSec : 1.2);
  if (saved == null || !Number.isFinite(saved) || saved <= 0) return round(audio);
  return round(Math.max(saved, audio));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
