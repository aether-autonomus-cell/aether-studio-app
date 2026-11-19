import type { StyleId } from "../schema";

export interface StyleManifest {
  id: StyleId;
  label: string;
  bg0: string;
  bg1: string;
  surface: string;
  ink: string;
  muted: string;
  accentPrimary: string;
  accentSecondary: string;
  emphasis: string;
  danger: string;
  strokePx: number;
  particleKind: "embers" | "rain" | "dust" | "stars";
}

export const STYLE_MANIFESTS: Record<StyleId, StyleManifest> = {
  "midnight-cyan@1": {
    id: "midnight-cyan@1",
    label: "Midnight Cyan",
    bg0: "#070B16",
    bg1: "#111A2E",
    surface: "#17243B",
    ink: "#F5F7FF",
    muted: "#B8C6DE",
    accentPrimary: "#5DE6FF",
    accentSecondary: "#A78BFA",
    emphasis: "#FFD166",
    danger: "#FF4D6D",
    strokePx: 3,
    particleKind: "dust",
  },
  "crimson-sakuga@1": {
    id: "crimson-sakuga@1",
    label: "Crimson Sakuga",
    bg0: "#09060E",
    bg1: "#1A0F24",
    surface: "#251430",
    ink: "#F5F7FF",
    muted: "#C8BED8",
    accentPrimary: "#FF4D6D",
    accentSecondary: "#FFD166",
    emphasis: "#5DE6FF",
    danger: "#FF4D6D",
    strokePx: 3.5,
    particleKind: "embers",
  },
  "amber-explainer@1": {
    id: "amber-explainer@1",
    label: "Amber Explainer",
    bg0: "#080D16",
    bg1: "#121D30",
    surface: "#192942",
    ink: "#F5F7FF",
    muted: "#B8C6DE",
    accentPrimary: "#FFD166",
    accentSecondary: "#5DE6FF",
    emphasis: "#A78BFA",
    danger: "#FF4D6D",
    strokePx: 2.5,
    particleKind: "stars",
  },
  "obsidian-gold@1": {
    id: "obsidian-gold@1",
    label: "Obsidian Gold",
    bg0: "#060811",
    bg1: "#111626",
    surface: "#1A2238",
    ink: "#F5F7FF",
    muted: "#B8C6DE",
    accentPrimary: "#FFD166",
    accentSecondary: "#A78BFA",
    emphasis: "#5DE6FF",
    danger: "#FF4D6D",
    strokePx: 3,
    particleKind: "rain",
  },
};

export function getStyleManifest(id: string | undefined): StyleManifest {
  if (id && id in STYLE_MANIFESTS) {
    return STYLE_MANIFESTS[id as StyleId];
  }
  return STYLE_MANIFESTS["midnight-cyan@1"];
}

/** Deterministic seeded PRNG (Mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
