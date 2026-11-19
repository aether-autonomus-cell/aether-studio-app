import { mulberry32 } from "./styles";

/**
 * Deterministic noLoop() p5.js-compatible 2D drawing adapter.
 * Supports common p5 2D scripts pasted from external AI tools without external CDNs
 * or slow CPU-heavy brush libraries.
 */
export function runDeterministicP5(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
  fps: number,
  seed: number,
  userCode: string,
): void {
  let rng = mulberry32(seed ^ ((frameIndex + 1) * 2654435761));
  let noiseRngSeed = seed;

  let fillStyleVal: string | null = "#F5F7FF";
  let strokeStyleVal: string | null = "#5DE6FF";
  let strokeW = 2;
  let colorModeType: "RGB" | "HSB" = "RGB";
  let rectModeVal: "CORNER" | "CENTER" = "CORNER";
  let shapeVertices: [number, number][] = [];
  let textFontVal = "'Inter', 'Noto Sans Devanagari', sans-serif";
  let textSizeVal = 32;

  const toCssColor = (a: number | string, b?: number, c?: number, d?: number): string => {
    if (typeof a === "string") return a;
    if (b === undefined) {
      const g = Math.max(0, Math.min(255, Math.round(a)));
      return `rgb(${g},${g},${g})`;
    }
    if (c === undefined) {
      const g = Math.max(0, Math.min(255, Math.round(a)));
      const alpha = Math.max(0, Math.min(1, b > 1 ? b / 255 : b));
      return `rgba(${g},${g},${g},${alpha})`;
    }
    const alpha = d === undefined ? 1 : d > 1 ? d / 255 : d;
    if (colorModeType === "HSB") {
      const h = ((a % 360) + 360) % 360;
      const s = Math.max(0, Math.min(100, b));
      const l = Math.max(0, Math.min(100, c * 0.65));
      return `hsla(${h},${s}%,${l}%,${alpha})`;
    }
    return `rgba(${Math.round(a)},${Math.round(b)},${Math.round(c)},${alpha})`;
  };

  const valueNoise = (x: number, y = 0): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const hash = (px: number, py: number) => {
      const h = Math.sin(px * 127.1 + py * 311.7 + noiseRngSeed * 0.13) * 43758.5453;
      return h - Math.floor(h);
    };
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  const p = {
    width,
    height,
    frameCount: frameIndex + 1,
    deltaTime: 1000 / fps,
    PI: Math.PI,
    TWO_PI: Math.PI * 2,
    HALF_PI: Math.PI / 2,
    CENTER: "CENTER" as const,
    CORNER: "CORNER" as const,
    LEFT: "left" as const,
    RIGHT: "right" as const,
    TOP: "top" as const,
    BOTTOM: "bottom" as const,
    CLOSE: "CLOSE" as const,
    RGB: "RGB" as const,
    HSB: "HSB" as const,
    noLoop: () => undefined,
    loop: () => undefined,
    createCanvas: () => undefined,
    noiseSeed: (s: number) => {
      noiseRngSeed = Math.floor(s);
    },
    randomSeed: (s: number) => {
      rng = mulberry32(Math.floor(s));
    },
    random: (min?: number | unknown[], max?: number): number => {
      if (Array.isArray(min)) {
        return min[Math.floor(rng() * min.length)] as number;
      }
      if (min === undefined) return rng();
      if (max === undefined) return rng() * min;
      return min + rng() * (max - min);
    },
    noise: (x: number, y = 0) => valueNoise(x, y),
    colorMode: (mode: "RGB" | "HSB") => {
      colorModeType = mode;
    },
    rectMode: (mode: "CORNER" | "CENTER") => {
      rectModeVal = mode;
    },
    background: (a: number | string, b?: number, c?: number, d?: number) => {
      ctx.save();
      ctx.fillStyle = toCssColor(a, b, c, d);
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
    fill: (a: number | string, b?: number, c?: number, d?: number) => {
      fillStyleVal = toCssColor(a, b, c, d);
    },
    noFill: () => {
      fillStyleVal = null;
    },
    stroke: (a: number | string, b?: number, c?: number, d?: number) => {
      strokeStyleVal = toCssColor(a, b, c, d);
    },
    noStroke: () => {
      strokeStyleVal = null;
    },
    strokeWeight: (w: number) => {
      strokeW = w;
    },
    push: () => ctx.save(),
    pop: () => ctx.restore(),
    translate: (x: number, y: number) => ctx.translate(x, y),
    rotate: (angle: number) => ctx.rotate(angle),
    scale: (sx: number, sy?: number) => ctx.scale(sx, sy ?? sx),
    rect: (x: number, y: number, w: number, h: number, r = 0) => {
      const rx = rectModeVal === "CENTER" ? x - w / 2 : x;
      const ry = rectModeVal === "CENTER" ? y - h / 2 : y;
      ctx.beginPath();
      if (r > 0 && typeof ctx.roundRect === "function") {
        ctx.roundRect(rx, ry, w, h, r);
      } else {
        ctx.rect(rx, ry, w, h);
      }
      if (fillStyleVal) {
        ctx.fillStyle = fillStyleVal;
        ctx.fill();
      }
      if (strokeStyleVal && strokeW > 0) {
        ctx.strokeStyle = strokeStyleVal;
        ctx.lineWidth = strokeW;
        ctx.stroke();
      }
    },
    ellipse: (x: number, y: number, w: number, h?: number) => {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h ?? w) / 2, 0, 0, Math.PI * 2);
      if (fillStyleVal) {
        ctx.fillStyle = fillStyleVal;
        ctx.fill();
      }
      if (strokeStyleVal && strokeW > 0) {
        ctx.strokeStyle = strokeStyleVal;
        ctx.lineWidth = strokeW;
        ctx.stroke();
      }
    },
    circle: (x: number, y: number, d: number) => {
      p.ellipse(x, y, d, d);
    },
    line: (x1: number, y1: number, x2: number, y2: number) => {
      if (!strokeStyleVal || strokeW <= 0) return;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = strokeStyleVal;
      ctx.lineWidth = strokeW;
      ctx.stroke();
    },
    triangle: (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      if (fillStyleVal) {
        ctx.fillStyle = fillStyleVal;
        ctx.fill();
      }
      if (strokeStyleVal && strokeW > 0) {
        ctx.strokeStyle = strokeStyleVal;
        ctx.lineWidth = strokeW;
        ctx.stroke();
      }
    },
    beginShape: () => {
      shapeVertices = [];
    },
    vertex: (x: number, y: number) => {
      shapeVertices.push([x, y]);
    },
    endShape: (mode?: string) => {
      if (shapeVertices.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(shapeVertices[0][0], shapeVertices[0][1]);
      for (let i = 1; i < shapeVertices.length; i += 1) {
        ctx.lineTo(shapeVertices[i][0], shapeVertices[i][1]);
      }
      if (mode === "CLOSE") ctx.closePath();
      if (fillStyleVal) {
        ctx.fillStyle = fillStyleVal;
        ctx.fill();
      }
      if (strokeStyleVal && strokeW > 0) {
        ctx.strokeStyle = strokeStyleVal;
        ctx.lineWidth = strokeW;
        ctx.stroke();
      }
      shapeVertices = [];
    },
    textSize: (s: number) => {
      textSizeVal = s;
    },
    textFont: (f: string) => {
      textFontVal = f;
    },
    textAlign: (align: CanvasTextAlign, baseline: CanvasTextBaseline = "alphabetic") => {
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
    },
    text: (str: string, x: number, y: number) => {
      ctx.font = `600 ${textSizeVal}px ${textFontVal}`;
      if (fillStyleVal) {
        ctx.fillStyle = fillStyleVal;
        ctx.fillText(String(str), x, y);
      }
    },
    sin: Math.sin,
    cos: Math.cos,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sqrt: Math.sqrt,
    pow: Math.pow,
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    map: (v: number, s1: number, e1: number, s2: number, e2: number) =>
      s2 + ((v - s1) / (e1 - s1 || 1)) * (e2 - s2),
    constrain: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
  };

  const envKeys = Object.keys(p);
  const envVals = Object.values(p);
  const fn = new Function(
    ...envKeys,
    `"use strict";
    ${userCode};
    if (typeof setup === "function") setup();
    noLoop();
    noiseSeed(${seed});
    if (typeof draw === "function") draw();`,
  );
  ctx.save();
  fn(...envVals);
  ctx.restore();
}
