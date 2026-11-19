import type {
  AspectRatio,
  CameraKeyframe,
  CharacterRigProps,
  LanguageCode,
  TransitionType,
} from "../schema";
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  mulberry32,
  type StyleManifest,
} from "./styles";
import {
  fontFamilyForLanguage,
  wrapTextMeasured,
  type SafeBox,
} from "./typography";

export interface RenderContextInfo {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
  safeBox: SafeBox;
  frameIndex: number;
  localFrame: number;
  localProgress: number;
  fps: number;
  seed: number;
  language: LanguageCode;
  style: StyleManifest;
  speechEnvelope: number;
}

/**
 * Primitive 1: GradientStage
 * Cached/deterministic multi-stop radial + linear gradients with atmospheric particles.
 */
export function drawGradientStage(
  rc: RenderContextInfo,
  focalX = 0.5,
  focalY = 0.38,
): void {
  const { ctx, width, height, frameIndex, fps, seed, style } = rc;
  const t = frameIndex / fps;

  const baseGrad = ctx.createLinearGradient(0, 0, width * 0.35, height);
  baseGrad.addColorStop(0, style.bg0);
  baseGrad.addColorStop(0.55, style.bg1);
  baseGrad.addColorStop(1, style.surface);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  const driftX = Math.sin(t * 0.45 + seed) * width * 0.04;
  const driftY = Math.cos(t * 0.38 + seed * 0.5) * height * 0.03;
  const fx = width * focalX + driftX;
  const fy = height * focalY + driftY;
  const rad = Math.max(width, height) * 0.72;
  const glow = ctx.createRadialGradient(fx, fy, rad * 0.04, fx, fy, rad);
  glow.addColorStop(0, hexWithAlpha(style.accentPrimary, 0.24));
  glow.addColorStop(0.45, hexWithAlpha(style.accentSecondary, 0.12));
  glow.addColorStop(1, "rgba(7, 11, 22, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Deterministic atmosphere particles (purely computed from frameIndex & seed)
  const rng = mulberry32(seed + 101);
  const count = 34;
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const x0 = rng();
    const y0 = rng();
    const speed = 0.04 + rng() * 0.09;
    const size = 1.5 + rng() * 3.5;
    const alpha = 0.2 + rng() * 0.45;
    if (style.particleKind === "rain") {
      const px = ((x0 * width + t * 140) % (width + 80)) - 40;
      const py = ((y0 * height + t * 920 * (0.6 + speed)) % (height + 120)) - 60;
      ctx.strokeStyle = hexWithAlpha(style.accentPrimary, alpha * 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 10, py + 38);
      ctx.stroke();
    } else if (style.particleKind === "embers") {
      const px = ((x0 + Math.sin(t * 1.4 + i) * 0.04) * width + width) % width;
      const py = ((y0 - t * speed * 1.2) % 1 + 1) % 1 * height;
      ctx.fillStyle = i % 2 === 0 ? hexWithAlpha(style.accentPrimary, alpha) : hexWithAlpha(style.emphasis, alpha);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const px = ((x0 + Math.sin(t * 0.7 + i * 1.3) * 0.025) * width + width) % width;
      const py = ((y0 - t * speed * 0.35) % 1 + 1) % 1 * height;
      ctx.fillStyle = i % 3 === 0 ? hexWithAlpha(style.accentPrimary, alpha) : hexWithAlpha(style.ink, alpha * 0.6);
      ctx.beginPath();
      ctx.arc(px, py, size * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Primitive 2: BackdropLayer
 * Procedural 2D skyline/temple/void-grid/storm silhouette + optional Hybrid anime image panel.
 */
export function drawBackdropLayer(
  rc: RenderContextInfo,
  mood: "skyline" | "temple" | "void-grid" | "storm" = "skyline",
  scrim = 0.55,
  hybridImage?: HTMLImageElement | null,
): void {
  const { ctx, width, height, frameIndex, fps, seed, style } = rc;
  const t = frameIndex / fps;
  const horizonY = height * 0.62;

  if (hybridImage && hybridImage.complete && hybridImage.naturalWidth > 0) {
    ctx.save();
    const imgRatio = hybridImage.naturalWidth / hybridImage.naturalHeight;
    const canvasRatio = width / height;
    let dw = width;
    let dh = height;
    if (imgRatio > canvasRatio) {
      dh = height;
      dw = dh * imgRatio;
    } else {
      dw = width;
      dh = dw / imgRatio;
    }
    const dx = (width - dw) * 0.5 + Math.sin(t * 0.4) * 8;
    const dy = (height - dh) * 0.5;
    ctx.globalAlpha = 0.72;
    ctx.drawImage(hybridImage, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.save();
    const rng = mulberry32(seed + 409);
    if (mood === "void-grid") {
      // Perspective cyber grid
      ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.2);
      ctx.lineWidth = 1.5;
      for (let i = -8; i <= 8; i += 1) {
        const bx = width * 0.5 + i * (width * 0.14);
        ctx.beginPath();
        ctx.moveTo(width * 0.5 + i * 18, horizonY);
        ctx.lineTo(bx, height);
        ctx.stroke();
      }
      const scroll = (t * 0.4) % 1;
      for (let r = 0; r < 10; r += 1) {
        const p = Math.pow((r + scroll) / 10, 1.8);
        const y = lerp(horizonY, height, p);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (mood === "temple") {
      // Layered stylized torii / mountain silhouettes
      ctx.fillStyle = hexWithAlpha(style.bg0, 0.75);
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, horizonY + 40);
      ctx.lineTo(width * 0.25, horizonY - 90);
      ctx.lineTo(width * 0.52, horizonY + 15);
      ctx.lineTo(width * 0.78, horizonY - 120);
      ctx.lineTo(width, horizonY + 25);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Torii gate silhouette
      const gx = width * 0.5;
      const gy = horizonY + 10;
      ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.45);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(gx - 90, gy - 150);
      ctx.lineTo(gx + 90, gy - 150);
      ctx.moveTo(gx - 70, gy - 115);
      ctx.lineTo(gx + 70, gy - 115);
      ctx.moveTo(gx - 55, gy - 150);
      ctx.lineTo(gx - 62, gy + 50);
      ctx.moveTo(gx + 55, gy - 150);
      ctx.lineTo(gx + 62, gy + 50);
      ctx.stroke();
    } else if (mood === "storm") {
      // Angular lightning horizon silhouettes
      ctx.fillStyle = hexWithAlpha(style.bg0, 0.72);
      ctx.fillRect(0, horizonY, width, height - horizonY);
      const flash = Math.sin(t * 2.1 + seed) > 0.92 ? 0.55 : 0.14;
      ctx.strokeStyle = hexWithAlpha(style.accentPrimary, flash);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(width * 0.65, height * 0.08);
      ctx.lineTo(width * 0.58, height * 0.28);
      ctx.lineTo(width * 0.64, height * 0.31);
      ctx.lineTo(width * 0.53, horizonY);
      ctx.stroke();
    } else {
      // Skyline silhouette buildings with subtle lit windows
      const cols = 14;
      const bw = width / cols;
      for (let i = 0; i < cols; i += 1) {
        const bh = 90 + rng() * (height * 0.28);
        const bx = i * bw;
        const by = horizonY + 90 - bh;
        ctx.fillStyle = i % 2 === 0 ? "rgba(7, 11, 22, 0.76)" : "rgba(17, 26, 46, 0.68)";
        ctx.fillRect(bx, by, bw + 1, height - by);
        ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.18);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        // Lit windows
        ctx.fillStyle = hexWithAlpha(style.accentPrimary, 0.35);
        for (let wy = by + 18; wy < horizonY + 50; wy += 24) {
          if (rng() > 0.45) {
            ctx.fillRect(bx + bw * 0.28, wy, bw * 0.44, 6);
          }
        }
      }
    }
    ctx.restore();
  }

  // Contrast scrim
  ctx.fillStyle = `rgba(7, 11, 22, ${clamp01(scrim)})`;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Primitive 3: SpeedLines
 * Pre-indexed anime action radial strokes rotated/pulsed via transform without allocating new paths.
 */
export function drawSpeedLines(
  rc: RenderContextInfo,
  opts: { enabled?: boolean; intensity?: number; originX?: number; originY?: number; color?: string },
): void {
  if (!opts.enabled) return;
  const { ctx, width, height, frameIndex, fps, seed, style } = rc;
  const intensity = clamp01(opts.intensity ?? 0.45);
  const ox = width * (opts.originX ?? 0.5);
  const oy = height * (opts.originY ?? 0.42);
  const t = frameIndex / fps;
  const color = opts.color ?? style.accentPrimary;
  const count = Math.round(28 + intensity * 36);
  const maxR = Math.hypot(width, height) * 0.95;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(t * 0.18);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + Math.sin(i * 7.3 + seed) * 0.04;
    const pulse = 0.5 + 0.5 * Math.sin(t * 9 + i * 2.1);
    const innerR = Math.min(width, height) * (0.24 + (i % 5) * 0.035 + pulse * 0.02);
    ctx.strokeStyle = hexWithAlpha(color, intensity * (0.14 + pulse * 0.24));
    ctx.lineWidth = i % 4 === 0 ? 3.2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
    ctx.lineTo(Math.cos(angle) * maxR, Math.sin(angle) * maxR);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Primitive 4: CharacterRig2D
 * Multi-layered vector 2D anime/stylized rig with deterministic blink, lip-sync,
 * hair/cape sine-wave flow, pose gestures, and crisp 3px rim strokes.
 */
export function drawCharacterRig2D(
  rc: RenderContextInfo,
  rig: CharacterRigProps | undefined,
  centerXRatio = 0.5,
  centerYRatio = 0.56,
  scaleFactor = 1.0,
): void {
  if (!rig) return;
  const { ctx, width, height, frameIndex, fps, style, speechEnvelope } = rc;
  const t = frameIndex / fps;

  const archetypeColors: Record<CharacterRigProps["archetype"], { coat: string; accent: string; hair: string; skin: string }> = {
    "hero-noir": { coat: "#0E162B", accent: style.accentPrimary, hair: "#1B2848", skin: "#F3D3BD" },
    "mentor-sage": { coat: "#1B2436", accent: style.emphasis, hair: "#D9E2F3", skin: "#EBC6AE" },
    "rival-crimson": { coat: "#241023", accent: "#FF4D6D", hair: "#3B132C", skin: "#F1D2C0" },
    "analyst-cyan": { coat: "#102136", accent: "#5DE6FF", hair: "#223A59", skin: "#F0CEB6" },
  };
  const pal = {
    ...archetypeColors[rig.archetype ?? "hero-noir"],
    ...(rig.palette ?? {}),
  };

  const baseUnit = Math.min(width, height) * 0.34 * scaleFactor;
  const breathY = Math.sin(t * 2.2) * (baseUnit * 0.018);
  const strideBob = rig.pose === "stride" ? Math.abs(Math.sin(t * 5.2)) * (baseUnit * 0.04) : 0;
  const cx = width * centerXRatio;
  const cy = height * centerYRatio + breathY - strideBob;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Flowing cloak / hair back layer
  const hairWave = Math.sin(t * 4.5) * (14 * (rig.hairFlow ?? 0.65));
  const capeWave = Math.cos(t * 3.6) * (18 * (rig.hairFlow ?? 0.65));

  ctx.fillStyle = pal.coat;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = Math.max(2.5, style.strokePx);
  ctx.beginPath();
  ctx.moveTo(-baseUnit * 0.42, baseUnit * 0.95);
  ctx.quadraticCurveTo(-baseUnit * 0.56 - capeWave, baseUnit * 0.32, -baseUnit * 0.25, -baseUnit * 0.08);
  ctx.lineTo(baseUnit * 0.25, -baseUnit * 0.08);
  ctx.quadraticCurveTo(baseUnit * 0.56 + capeWave, baseUnit * 0.32, baseUnit * 0.44, baseUnit * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Sharp anime collar lapels
  ctx.fillStyle = "#17243B";
  ctx.beginPath();
  ctx.moveTo(-baseUnit * 0.22, -baseUnit * 0.08);
  ctx.lineTo(-baseUnit * 0.05, baseUnit * 0.25);
  ctx.lineTo(0, baseUnit * 0.14);
  ctx.lineTo(baseUnit * 0.05, baseUnit * 0.25);
  ctx.lineTo(baseUnit * 0.22, -baseUnit * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Arm / gesture pose
  if (rig.pose === "pointing" || rig.pose === "determined") {
    const raise = rig.pose === "pointing" ? -baseUnit * 0.08 : baseUnit * 0.12;
    ctx.fillStyle = pal.coat;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(baseUnit * 0.24, baseUnit * 0.08);
    ctx.lineTo(baseUnit * 0.58, raise);
    ctx.lineTo(baseUnit * 0.62, raise + baseUnit * 0.12);
    ctx.lineTo(baseUnit * 0.26, baseUnit * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Neck
  ctx.fillStyle = pal.skin;
  ctx.fillRect(-baseUnit * 0.065, -baseUnit * 0.21, baseUnit * 0.13, baseUnit * 0.16);

  // Back spiky anime hair silhouette
  ctx.fillStyle = pal.hair;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-baseUnit * 0.24, -baseUnit * 0.36);
  ctx.lineTo(-baseUnit * 0.34 - hairWave * 0.4, -baseUnit * 0.18);
  ctx.lineTo(-baseUnit * 0.18, -baseUnit * 0.24);
  ctx.lineTo(baseUnit * 0.18, -baseUnit * 0.24);
  ctx.lineTo(baseUnit * 0.35 + hairWave * 0.4, -baseUnit * 0.17);
  ctx.lineTo(baseUnit * 0.24, -baseUnit * 0.36);
  ctx.closePath();
  ctx.fill();

  // Head / jawline (anime chin)
  ctx.fillStyle = pal.skin;
  ctx.strokeStyle = "#0A0F1F";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-baseUnit * 0.18, -baseUnit * 0.48);
  ctx.lineTo(-baseUnit * 0.17, -baseUnit * 0.29);
  ctx.lineTo(0, -baseUnit * 0.19);
  ctx.lineTo(baseUnit * 0.17, -baseUnit * 0.29);
  ctx.lineTo(baseUnit * 0.18, -baseUnit * 0.48);
  ctx.quadraticCurveTo(0, -baseUnit * 0.63, -baseUnit * 0.18, -baseUnit * 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Eyes + deterministic blink every ~3.2s + gaze offset
  const blinkPhase = (t + 0.7) % 3.2;
  const isBlinking = blinkPhase > 3.06;
  const gazeX = rig.gaze === "left" ? -5 : rig.gaze === "right" ? 5 : 0;
  const gazeY = rig.gaze === "up" ? -3 : 0;

  for (const side of [-1, 1]) {
    const ex = side * baseUnit * 0.082;
    const ey = -baseUnit * 0.37;
    if (isBlinking) {
      ctx.strokeStyle = "#111A2E";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - baseUnit * 0.042, ey);
      ctx.lineTo(ex + baseUnit * 0.042, ey);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#F5F7FF";
      ctx.beginPath();
      ctx.ellipse(ex, ey, baseUnit * 0.044, baseUnit * 0.028, 0, 0, Math.PI * 2);
      ctx.fill();
      // Iris
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.arc(ex + gazeX, ey + gazeY, baseUnit * 0.022, 0, Math.PI * 2);
      ctx.fill();
      // Pupil + catchlight
      ctx.fillStyle = "#070B16";
      ctx.beginPath();
      ctx.arc(ex + gazeX, ey + gazeY, baseUnit * 0.011, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(ex + gazeX - 2.5, ey + gazeY - 2.5, baseUnit * 0.006, 0, Math.PI * 2);
      ctx.fill();
    }
    // Expressive eyebrow
    const browTilt = rig.pose === "determined" || rig.pose === "shocked" ? side * 0.014 : 0;
    ctx.strokeStyle = "#0F172A";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex - baseUnit * 0.046, ey - baseUnit * 0.048 - browTilt * baseUnit);
    ctx.lineTo(ex + baseUnit * 0.046, ey - baseUnit * 0.052 + browTilt * baseUnit);
    ctx.stroke();
  }

  // Mouth lip-sync driven by speechEnvelope or explicit mouthState
  const mouthOpen =
    rig.mouthState === "shout"
      ? 0.9
      : rig.mouthState === "open"
        ? 0.55
        : rig.mouthState === "closed"
          ? 0
          : speechEnvelope;
  const mouthY = -baseUnit * 0.265;
  ctx.fillStyle = "#481926";
  ctx.strokeStyle = "#111A2E";
  ctx.lineWidth = 2;
  if (mouthOpen > 0.14) {
    ctx.beginPath();
    ctx.ellipse(0, mouthY, baseUnit * 0.04, baseUnit * (0.01 + mouthOpen * 0.028), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-baseUnit * 0.036, mouthY);
    ctx.lineTo(baseUnit * 0.036, mouthY);
    ctx.stroke();
  }

  // Front hair bangs with flowing sine wave
  ctx.fillStyle = pal.hair;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-baseUnit * 0.21, -baseUnit * 0.45);
  ctx.quadraticCurveTo(0, -baseUnit * 0.72, baseUnit * 0.21, -baseUnit * 0.45);
  ctx.lineTo(baseUnit * 0.17 + hairWave * 0.25, -baseUnit * 0.39);
  ctx.lineTo(baseUnit * 0.06, -baseUnit * 0.47);
  ctx.lineTo(hairWave * 0.3, -baseUnit * 0.37);
  ctx.lineTo(-baseUnit * 0.08, -baseUnit * 0.47);
  ctx.lineTo(-baseUnit * 0.18 + hairWave * 0.2, -baseUnit * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * Primitive 5: PanelReveal
 * Manhwa/manga multi-panel geometric clip frame with staggered entrance and accent borders.
 */
export function drawPanelReveal(
  rc: RenderContextInfo,
  opts: { layout?: "single" | "split-diagonal" | "triptych"; direction?: "left" | "right" | "up"; borderPx?: number } | undefined,
  drawContent: () => void,
): void {
  const { ctx, width, height, localFrame, fps, style } = rc;
  const enter = easeOutCubic(Math.min(1, localFrame / Math.max(1, fps * 0.35)));
  const border = opts?.borderPx ?? 3;
  const pad = Math.round(Math.min(width, height) * 0.035);

  ctx.save();
  const slideOffset =
    opts?.direction === "right"
      ? (1 - enter) * width * 0.12
      : opts?.direction === "up"
        ? (1 - enter) * height * 0.08
        : -(1 - enter) * width * 0.12;
  ctx.translate(opts?.direction === "up" ? 0 : slideOffset, opts?.direction === "up" ? slideOffset : 0);

  if (opts?.layout === "split-diagonal") {
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(width - pad, pad);
    ctx.lineTo(width - pad, height - pad);
    ctx.lineTo(pad, height - pad);
    ctx.closePath();
    ctx.clip();
    drawContent();

    // Diagonal manhwa divider slash
    ctx.strokeStyle = style.accentPrimary;
    ctx.lineWidth = border;
    ctx.beginPath();
    ctx.moveTo(pad, height * 0.22);
    ctx.lineTo(width - pad, height * 0.14);
    ctx.stroke();
  } else {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, 18);
    } else {
      ctx.rect(pad, pad, width - pad * 2, height - pad * 2);
    }
    ctx.clip();
    drawContent();
    ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.72);
    ctx.lineWidth = border;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Primitive 6: Camera2D
 * Pure 2D affine transforms interpolating CameraKeyframe[] with cubic-bezier easing + impact shake.
 */
export function applyCamera2D(
  rc: RenderContextInfo,
  keyframes: CameraKeyframe[],
  drawWorld: () => void,
): void {
  const { ctx, width, height, localProgress, frameIndex, seed } = rc;
  const sorted = [...(keyframes.length ? keyframes : [{ at: 0, x: 0.5, y: 0.5, zoom: 1, shake: 0 }])].sort(
    (a, b) => a.at - b.at,
  );
  let k0 = sorted[0];
  let k1 = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (localProgress >= sorted[i].at && localProgress <= sorted[i + 1].at) {
      k0 = sorted[i];
      k1 = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, k1.at - k0.at);
  const segT = k1 === k0 ? 0 : easeInOutCubic((localProgress - k0.at) / span);
  const cx = lerp(k0.x, k1.x, segT);
  const cy = lerp(k0.y, k1.y, segT);
  const zoom = lerp(k0.zoom, k1.zoom, segT);
  const shakeAmt = lerp(k0.shake, k1.shake, segT);
  const shakeX = shakeAmt > 0 ? Math.sin(frameIndex * 1.9 + seed) * width * shakeAmt * 0.3 : 0;
  const shakeY = shakeAmt > 0 ? Math.cos(frameIndex * 2.3 + seed * 1.7) * height * shakeAmt * 0.3 : 0;

  ctx.save();
  ctx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
  ctx.scale(zoom, zoom);
  ctx.translate(-width * cx, -height * cy);
  drawWorld();
  ctx.restore();
}

/**
 * Primitive 7: KineticText
 * Measured glyph-safe kinetic headline + subhead over a high-contrast dark scrim.
 */
export function drawKineticText(
  rc: RenderContextInfo,
  opts: {
    text: string;
    subtext?: string;
    emphasis?: string[];
    yRatio?: number;
    align?: CanvasTextAlign;
    fontSizePx?: number;
  },
): void {
  const { ctx, safeBox, height, localFrame, fps, language, style } = rc;
  if (!opts.text.trim()) return;

  const enter = easeOutCubic(Math.min(1, localFrame / Math.max(1, fps * 0.28)));
  const fontSize = opts.fontSizePx ?? Math.round(Math.min(safeBox.width * 0.085, 68));
  const subSize = Math.round(fontSize * 0.52);
  const lineH = Math.round(fontSize * 1.24);
  const font = `700 ${fontSize}px ${fontFamilyForLanguage(language, true)}`;

  ctx.save();
  ctx.font = font;
  const maxW = safeBox.width - 48;
  const lines = wrapTextMeasured(ctx, opts.text, maxW, language, 3);
  const boxH = lines.length * lineH + (opts.subtext ? subSize * 1.6 : 0) + 42;
  const yTop = height * (opts.yRatio ?? 0.14) + (1 - enter) * 24;

  // High-contrast scrim card
  ctx.globalAlpha = enter;
  ctx.fillStyle = "rgba(7, 11, 22, 0.78)";
  ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.55);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(safeBox.x, yTop, safeBox.width, boxH, 16);
  } else {
    ctx.rect(safeBox.x, yTop, safeBox.width, boxH);
  }
  ctx.fill();
  ctx.stroke();

  const align = opts.align ?? "center";
  const textX =
    align === "left"
      ? safeBox.x + 24
      : align === "right"
        ? safeBox.right - 24
        : safeBox.x + safeBox.width * 0.5;

  ctx.textAlign = align;
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasEmphasis = (opts.emphasis ?? []).some((e) =>
      line.toLowerCase().includes(e.toLowerCase()),
    );
    ctx.fillStyle = hasEmphasis ? style.emphasis : style.ink;
    ctx.fillText(line, textX, yTop + 20 + i * lineH);
  }

  // Animated accent underline
  const underW = (safeBox.width - 80) * enter;
  ctx.fillStyle = style.accentPrimary;
  ctx.fillRect(safeBox.x + 40, yTop + 20 + lines.length * lineH + 4, underW, 4);

  if (opts.subtext) {
    ctx.font = `600 ${subSize}px ${fontFamilyForLanguage(language, false)}`;
    ctx.fillStyle = style.muted;
    const subLines = wrapTextMeasured(ctx, opts.subtext, maxW, language, 2);
    ctx.fillText(subLines[0] ?? "", textX, yTop + 30 + lines.length * lineH);
  }
  ctx.restore();
}

/**
 * Primitive 8: Counter / BarChart
 * Eased numeric interpolation and clean vector bar chart for exact user-supplied data.
 */
export function drawCounterBarChart(
  rc: RenderContextInfo,
  chart: { values: number[]; labels: string[]; unit?: string; source?: string } | undefined,
): void {
  if (!chart || chart.values.length === 0) return;
  const { ctx, safeBox, height, localFrame, fps, language, style } = rc;
  const enter = easeOutCubic(Math.min(1, localFrame / Math.max(1, fps * 0.6)));

  const cardY = height * 0.36;
  const cardH = height * 0.34;
  ctx.save();
  ctx.fillStyle = "rgba(7, 11, 22, 0.82)";
  ctx.strokeStyle = hexWithAlpha(style.accentPrimary, 0.5);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(safeBox.x, cardY, safeBox.width, cardH, 18);
  } else {
    ctx.rect(safeBox.x, cardY, safeBox.width, cardH);
  }
  ctx.fill();
  ctx.stroke();

  const maxVal = Math.max(1, ...chart.values.map((v) => Math.abs(v)));
  const count = chart.values.length;
  const innerX = safeBox.x + 28;
  const innerW = safeBox.width - 56;
  const slotH = (cardH - 56) / count;

  for (let i = 0; i < count; i += 1) {
    const val = chart.values[i] ?? 0;
    const label = chart.labels[i] ?? `Item ${i + 1}`;
    const y = cardY + 26 + i * slotH;
    const barH = Math.min(28, slotH * 0.48);
    const barW = Math.max(8, (Math.abs(val) / maxVal) * innerW * 0.72 * enter);

    ctx.font = `600 24px ${fontFamilyForLanguage(language, false)}`;
    ctx.fillStyle = style.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, innerX, y + barH * 0.5);

    const barY = y + barH * 0.95;
    const grad = ctx.createLinearGradient(innerX, barY, innerX + barW, barY);
    grad.addColorStop(0, style.accentPrimary);
    grad.addColorStop(1, style.accentSecondary);
    ctx.fillStyle = grad;
    ctx.fillRect(innerX, barY, barW, Math.max(12, barH * 0.62));

    const displayVal = Math.round(val * enter * 10) / 10;
    ctx.font = `700 24px ${fontFamilyForLanguage(language, true)}`;
    ctx.fillStyle = style.emphasis;
    ctx.fillText(`${displayVal}${chart.unit ? ` ${chart.unit}` : ""}`, innerX + barW + 12, barY + 8);
  }

  if (chart.source) {
    ctx.font = `500 18px ${fontFamilyForLanguage(language, false)}`;
    ctx.fillStyle = style.muted;
    ctx.textAlign = "right";
    ctx.fillText(chart.source, safeBox.right - 24, cardY + cardH - 22);
  }
  ctx.restore();
}

/**
 * Primitive 9: FlowDiagram
 * Stable spatial node-edge causal diagram with animated stroke-dashoffset connectors.
 */
export function drawFlowDiagram(
  rc: RenderContextInfo,
  flow: { nodes: { id: string; label: string }[]; edges: [number, number][]; activeStep: number } | undefined,
): void {
  if (!flow || flow.nodes.length === 0) return;
  const { ctx, safeBox, height, frameIndex, fps, language, style } = rc;
  const t = frameIndex / fps;
  const count = flow.nodes.length;
  const isVertical = safeBox.width < height * 0.65;

  const boxW = isVertical ? safeBox.width * 0.76 : Math.min(260, (safeBox.width - 80) / count);
  const boxH = isVertical ? 96 : 112;
  const centerY = height * 0.5;
  const centerX = safeBox.x + safeBox.width * 0.5;

  const coords = flow.nodes.map((_, i) => {
    if (isVertical) {
      const span = Math.min(height * 0.42, count * 145);
      const y0 = centerY - span * 0.5;
      const step = count > 1 ? span / (count - 1) : 0;
      return { x: centerX - boxW * 0.5, y: y0 + i * step - boxH * 0.5 };
    }
    const span = safeBox.width - boxW - 40;
    const x0 = safeBox.x + 20;
    const step = count > 1 ? span / (count - 1) : 0;
    return { x: x0 + i * step, y: centerY - boxH * 0.5 };
  });

  ctx.save();
  // Animated dashed edges
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 10]);
  ctx.lineDashOffset = -t * 48;
  for (const [fromIdx, toIdx] of flow.edges) {
    const a = coords[fromIdx];
    const b = coords[toIdx];
    if (!a || !b) continue;
    ctx.strokeStyle = style.accentPrimary;
    ctx.beginPath();
    ctx.moveTo(a.x + boxW * 0.5, a.y + boxH * 0.5);
    ctx.lineTo(b.x + boxW * 0.5, b.y + boxH * 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Node cards
  for (let i = 0; i < flow.nodes.length; i += 1) {
    const node = flow.nodes[i];
    const pos = coords[i];
    const active = i === flow.activeStep;
    ctx.fillStyle = active ? "#1B2E4E" : "rgba(7, 11, 22, 0.88)";
    ctx.strokeStyle = active ? style.emphasis : style.accentPrimary;
    ctx.lineWidth = active ? 4 : 2.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(pos.x, pos.y, boxW, boxH, 16);
    } else {
      ctx.rect(pos.x, pos.y, boxW, boxH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 28px ${fontFamilyForLanguage(language, true)}`;
    ctx.fillStyle = active ? style.emphasis : style.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.label, pos.x + boxW * 0.5, pos.y + boxH * 0.5);
  }
  ctx.restore();
}

/**
 * Primitive 10: CaptionLayer & Transition2D
 * Max 2-line pixel-measured captions inside safeBox over high-contrast scrim,
 * plus 6–12 frame deterministic scene transition overlays.
 */
export function drawCaptionLayer(
  rc: RenderContextInfo,
  narrationText: string,
): void {
  const { ctx, safeBox, language, style, localProgress } = rc;
  const clean = narrationText.trim();
  if (!clean) return;

  const fontSize = Math.round(Math.max(24, Math.min(safeBox.width * 0.044, 40)));
  const lineH = Math.round(fontSize * 1.32);
  ctx.save();
  ctx.font = `600 ${fontSize}px ${fontFamilyForLanguage(language, false)}`;
  const lines = wrapTextMeasured(ctx, clean, safeBox.width - 44, language, 2);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const boxH = lines.length * lineH + 28;
  const boxY = safeBox.bottom - boxH;

  ctx.fillStyle = "rgba(7, 11, 22, 0.82)";
  ctx.strokeStyle = hexWithAlpha(style.accentSecondary, 0.42);
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(safeBox.x, boxY, safeBox.width, boxH, 14);
  } else {
    ctx.rect(safeBox.x, boxY, safeBox.width, boxH);
  }
  ctx.fill();
  ctx.stroke();

  // Active reading progress bar
  ctx.fillStyle = style.accentPrimary;
  ctx.fillRect(safeBox.x + 14, boxY + boxH - 5, (safeBox.width - 28) * clamp01(localProgress), 3);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = style.ink;
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], safeBox.x + safeBox.width * 0.5, boxY + 14 + i * lineH);
  }
  ctx.restore();
}

export function drawTransition2D(
  rc: RenderContextInfo,
  transition: TransitionType,
): void {
  if (transition === "cut") return;
  const { ctx, width, height, localFrame, style } = rc;
  const transitionFrames = 9;
  if (localFrame >= transitionFrames) return;
  const p = localFrame / transitionFrames;

  ctx.save();
  if (transition === "dissolve") {
    ctx.fillStyle = `rgba(7, 11, 22, ${(1 - p) * 0.65})`;
    ctx.fillRect(0, 0, width, height);
  } else if (transition === "wipe") {
    const wipeX = width * p;
    ctx.fillStyle = style.bg0;
    ctx.fillRect(wipeX, 0, width - wipeX, height);
    ctx.fillStyle = style.accentPrimary;
    ctx.fillRect(wipeX - 4, 0, 6, height);
  } else if (transition === "slide") {
    ctx.fillStyle = style.bg0;
    ctx.fillRect(0, 0, width, height * (1 - p) * 0.5);
    ctx.fillRect(0, height - height * (1 - p) * 0.5, width, height * (1 - p) * 0.5);
  }
  ctx.restore();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(93, 230, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}
