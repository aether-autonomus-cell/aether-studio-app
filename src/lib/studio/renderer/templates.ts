import type { LanguageCode, SceneNode } from "../schema";
import { runDeterministicP5 } from "./p5-adapter";
import {
  applyCamera2D,
  drawBackdropLayer,
  drawCaptionLayer,
  drawCharacterRig2D,
  drawCounterBarChart,
  drawFlowDiagram,
  drawGradientStage,
  drawKineticText,
  drawPanelReveal,
  drawSpeedLines,
  drawTransition2D,
  type RenderContextInfo,
} from "./primitives";

function pickDual(
  dual: { "hi-IN"?: string; "en-US"?: string } | undefined,
  lang: LanguageCode,
): string {
  if (!dual) return "";
  const primary = dual[lang]?.trim();
  if (primary) return primary;
  const fallback = dual[lang === "hi-IN" ? "en-US" : "hi-IN"]?.trim();
  return fallback ?? "";
}

export function renderSceneTemplate(
  rc: RenderContextInfo,
  scene: SceneNode,
  hybridImage?: HTMLImageElement | null,
  customSvgEl?: SVGSVGElement | null,
): void {
  const { language, ctx, width, height } = rc;
  const props = scene.props ?? {};
  const headline = pickDual(props.headline, language);
  const subhead = pickDual(props.subhead, language);
  const narration = pickDual(scene.narration, language);

  if (scene.template_id === "custom-canvas@1" && props.customCode?.code) {
    const { kind, code } = props.customCode;
    if (kind === "p5") {
      runDeterministicP5(ctx, width, height, rc.frameIndex, rc.fps, rc.seed, code);
      if (narration) drawCaptionLayer(rc, narration);
      return;
    }
    if (kind === "svg" && customSvgEl) {
      drawGradientStage(rc);
      ctx.save();
      const serialized = new XMLSerializer().serializeToString(customSvgEl);
      ctx.restore();
      void serialized;
      // SVG custom mode is mounted into the overlay SVG element by runtime.ts;
      // still render caption layer cleanly on canvas.
      if (narration) drawCaptionLayer(rc, narration);
      return;
    }
  }

  const renderWorld = () => {
    drawGradientStage(rc, 0.5, scene.template_id === "action-pan@1" ? 0.35 : 0.42);
    drawBackdropLayer(
      rc,
      props.backdrop?.mood ?? "skyline",
      props.backdrop?.scrim ?? 0.55,
      hybridImage,
    );

    if (props.speedLines?.enabled || scene.template_id === "action-pan@1") {
      drawSpeedLines(rc, {
        enabled: true,
        intensity: props.speedLines?.intensity ?? 0.55,
        originX: props.speedLines?.originX ?? 0.5,
        originY: props.speedLines?.originY ?? 0.45,
        color: props.speedLines?.color,
      });
    }

    switch (scene.template_id) {
      case "hook-card@1": {
        drawCharacterRig2D(rc, props.character, 0.5, 0.62, 0.92);
        drawKineticText(rc, {
          text: headline || narration.slice(0, 60),
          subtext: subhead,
          emphasis: props.emphasis,
          yRatio: 0.16,
          align: "center",
        });
        break;
      }

      case "manhwa-dialogue@1": {
        drawPanelReveal(rc, props.panelReveal ?? { layout: "split-diagonal", direction: "left", borderPx: 3 }, () => {
          drawCharacterRig2D(
            rc,
            props.character ?? {
              archetype: "hero-noir",
              pose: "determined",
              gaze: "camera",
              mouthState: "auto",
              hairFlow: 0.7,
            },
            0.5,
            0.61,
            1.04,
          );
        });
        if (headline) {
          drawKineticText(rc, {
            text: headline,
            subtext: subhead,
            emphasis: props.emphasis,
            yRatio: 0.11,
            align: "center",
            fontSizePx: Math.round(Math.min(rc.safeBox.width * 0.068, 52)),
          });
        }
        break;
      }

      case "action-pan@1": {
        const panOffset = Math.sin(rc.localProgress * Math.PI) * 0.06;
        drawCharacterRig2D(
          rc,
          props.character ?? {
            archetype: "rival-crimson",
            pose: "stride",
            gaze: "right",
            mouthState: "shout",
            hairFlow: 0.95,
          },
          0.46 + panOffset,
          0.6,
          1.1,
        );
        if (headline) {
          drawKineticText(rc, {
            text: headline,
            subtext: subhead,
            emphasis: props.emphasis,
            yRatio: 0.12,
            align: "left",
          });
        }
        break;
      }

      case "cause-effect@1": {
        if (headline) {
          drawKineticText(rc, {
            text: headline,
            subtext: subhead,
            emphasis: props.emphasis,
            yRatio: 0.1,
            align: "center",
            fontSizePx: Math.round(Math.min(rc.safeBox.width * 0.066, 50)),
          });
        }
        drawFlowDiagram(
          rc,
          props.flow ?? {
            nodes: [
              { id: "a", label: "Spark" },
              { id: "b", label: "Shift" },
              { id: "c", label: "Payoff" },
            ],
            edges: [
              [0, 1],
              [1, 2],
            ],
            activeStep: Math.min(2, Math.floor(rc.localProgress * 3)),
          },
        );
        break;
      }

      case "comparison@1": {
        if (headline) {
          drawKineticText(rc, {
            text: headline,
            subtext: subhead,
            emphasis: props.emphasis,
            yRatio: 0.1,
            align: "center",
            fontSizePx: Math.round(Math.min(rc.safeBox.width * 0.068, 50)),
          });
        }
        drawCounterBarChart(
          rc,
          props.chart ?? {
            values: [42, 86, 100],
            labels: ["Baseline", "Scene Graph", "Dual Output"],
            unit: "%",
          },
        );
        break;
      }

      case "recap-payoff@1":
      default: {
        drawCharacterRig2D(
          rc,
          props.character ?? {
            archetype: "analyst-cyan",
            pose: "pointing",
            gaze: "camera",
            mouthState: "auto",
            hairFlow: 0.55,
          },
          0.5,
          0.62,
          0.95,
        );
        drawKineticText(rc, {
          text: headline || "AETHER STUDIO V2",
          subtext: subhead,
          emphasis: props.emphasis,
          yRatio: 0.12,
          align: "center",
        });
        break;
      }
    }
  };

  applyCamera2D(rc, scene.camera, renderWorld);
  drawCaptionLayer(rc, narration);
  drawTransition2D(rc, scene.transition);
}
