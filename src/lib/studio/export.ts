import type { Project, Scene } from "@/lib/studio/model";
import { dialogueWithoutSpeaker } from "@/lib/studio/model";

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const push = (value: string) => {
    if (value) lines.push(value);
  };
  for (const word of words) {
    if (ctx.measureText(word).width > maxWidth) {
      push(current);
      current = "";
      let piece = "";
      for (const char of word) {
        if (ctx.measureText(piece + char).width > maxWidth && piece) {
          push(piece);
          piece = char;
        } else {
          piece += char;
        }
      }
      current = piece;
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      push(current);
      current = word;
    } else {
      current = next;
    }
  }
  push(current);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

async function drawPanel(scene: Scene): Promise<HTMLCanvasElement> {
  const width = 720;
  const height = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#1c1815";
  ctx.fillRect(0, 0, width, height);
  if (scene.imageUrl) {
    const image = await loadImage(scene.imageUrl);
    if (image) {
      const scale = Math.max(width / image.width, height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    }
  } else {
    ctx.fillStyle = "#26201c";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#a39484";
    ctx.font = "600 18px Outfit, sans-serif";
    ctx.fillText("NOT PAINTED", width / 2, height * 0.42);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  const dialogue = dialogueWithoutSpeaker(scene);
  const speaker = scene.speaker.trim();
  const caption = scene.caption.trim();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  let captionLines: string[] = [];
  let captionFont = 22;
  if (caption) {
    ctx.font = `500 ${captionFont}px Outfit, sans-serif`;
    captionLines = wrapLines(ctx, caption, width - 48);
    if (captionLines.length > 4) {
      captionFont = 18;
      ctx.font = `500 ${captionFont}px Outfit, sans-serif`;
      captionLines = wrapLines(ctx, caption, width - 48);
    }
  }
  const captionLineH = captionFont + 8;
  const captionH = captionLines.length ? 20 + captionLines.length * captionLineH : 0;

  if (scene.sfx) {
    ctx.save();
    ctx.translate(36, 28);
    ctx.rotate(-0.08);
    ctx.font = "660 64px Fraunces, Georgia, serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#14110f";
    ctx.strokeText(scene.sfx, 0, 0);
    ctx.fillStyle = "#e24b32";
    ctx.fillText(scene.sfx, 0, 0);
    ctx.restore();
  }

  if (dialogue) {
    const maxWidth = width - 112;
    let fontSize = 28;
    let lines: string[] = [];
    const gap = () => Math.round(fontSize * 0.35);
    const head = speaker ? 36 : 0;
    const blockHeight = () => 32 + head + lines.length * (fontSize + gap());
    const fit = () => {
      ctx.font = `500 ${fontSize}px Outfit, sans-serif`;
      lines = wrapLines(ctx, dialogue, maxWidth);
      return blockHeight();
    };
    let boxH = fit();
    const maxH = Math.max(120, height - captionH - 72);
    while (fontSize > 14 && boxH > maxH) {
      fontSize -= 1;
      boxH = fit();
    }
    const boxY = Math.max(24, height - captionH - boxH - 16);
    ctx.fillStyle = "rgba(243,234,219,0.96)";
    roundRect(ctx, 28, boxY, width - 56, boxH, 22);
    let y = boxY + 16;
    if (speaker) {
      ctx.fillStyle = "#9e2616";
      ctx.font = "600 14px Outfit, sans-serif";
      ctx.fillText(speaker.toUpperCase(), 52, y);
      y += 28;
    }
    ctx.fillStyle = "#14110f";
    ctx.font = `500 ${fontSize}px Outfit, sans-serif`;
    const step = fontSize + gap();
    for (const line of lines) {
      ctx.fillText(line, 52, y);
      y += step;
    }
  }

  if (captionLines.length) {
    const barTop = height - captionH;
    ctx.fillStyle = "rgba(20,17,15,0.92)";
    ctx.fillRect(0, barTop, width, captionH);
    ctx.fillStyle = "#f3eadb";
    ctx.font = `500 ${captionFont}px Outfit, sans-serif`;
    captionLines.forEach((line, lineIndex) => {
      ctx.fillText(line, 24, barTop + 12 + lineIndex * captionLineH);
    });
  }
  return canvas;
}

export async function renderStripPng(project: Project): Promise<Blob> {
  const panels = await Promise.all(project.scenes.map((scene) => drawPanel(scene)));
  const gap = 16;
  const width = 720;
  const height = panels.reduce((sum, panel) => sum + panel.height, 0) + gap * Math.max(0, panels.length - 1);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("Could not draw the strip.");
  ctx.fillStyle = "#14110f";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const panel of panels) {
    ctx.drawImage(panel, 0, y);
    y += panel.height + gap;
  }
  const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not save the strip.");
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const MALE = /male|guy|david|ravi|prabhat|madhur|daniel|fred|rishi|arthur|aaron/i;
const FEMALE = /female|woman|zira|samantha|veena|heera|eva|susan|salli|victoria|fiona/i;

export function pickMaleVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  const hindi = voices.filter((voice) => /hi[-_]?in|hindi/i.test(`${voice.lang} ${voice.name}`));
  const pool = hindi.length ? hindi : voices;
  return pool.find((voice) => MALE.test(voice.name) && !FEMALE.test(voice.name)) ?? null;
}

export function speakOnDevice(text: string, voice: SpeechSynthesisVoice): Promise<void> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || "en-IN";
    utterance.rate = 0.96;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("This phone stopped the reading."));
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}
