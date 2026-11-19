import { AETHER_RUNTIME_JS } from "./renderer/runtime-bundle";
import { buildRenderBundle } from "./renderer/runtime";
import type { LanguageCode, SceneGraphV1 } from "./schema";

/**
 * Generates strict-CSP HTML for the sandboxed <iframe sandbox="allow-scripts"> live preview.
 * Communication occurs strictly over a transferred MessageChannel with per-instance nonce validation.
 * Zero external network calls are permitted by the CSP.
 */
export function compileSandboxHtml(nonce: string): string {
  const safeNonce = JSON.stringify(nonce);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data: blob:; img-src data: blob:;" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #070B16;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
    background: #070B16;
  }
  #aether-svg-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="stage">
  <canvas id="aether-canvas"></canvas>
  <svg id="aether-svg-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
</div>
<script>
${AETHER_RUNTIME_JS}
</script>
<script>
(function() {
  var EXPECTED_NONCE = ${safeNonce};
  var port = null;
  var fontsLoaded = false;

  async function installFonts(fonts) {
    if (fontsLoaded || !Array.isArray(fonts)) return;
    for (var i = 0; i < fonts.length; i++) {
      var f = fonts[i];
      try {
        var face = new FontFace(f.family, f.buffer, { weight: String(f.weight || "400"), style: "normal" });
        await face.load();
        document.fonts.add(face);
      } catch (e) {
        // Fallback to system fonts if FontFace fails
      }
    }
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    fontsLoaded = true;
  }

  window.addEventListener("message", function(ev) {
    var data = ev.data;
    if (!data || data.type !== "aether:connect" || data.nonce !== EXPECTED_NONCE) return;
    if (!ev.ports || !ev.ports[0]) return;
    port = ev.ports[0];
    port.onmessage = async function(msgEv) {
      var msg = msgEv.data;
      if (!msg || msg.nonce !== EXPECTED_NONCE) return;
      try {
        if (msg.type === "aether:fonts") {
          await installFonts(msg.fonts);
          port.postMessage({ type: "aether:fonts-ready", nonce: EXPECTED_NONCE });
        } else if (msg.type === "aether:init") {
          var meta = await window.Aether.init(msg.bundle);
          port.postMessage({ type: "aether:inited", id: msg.id, meta: meta, nonce: EXPECTED_NONCE });
        } else if (msg.type === "aether:render") {
          await window.Aether.renderAt(msg.frameIndex);
          port.postMessage({ type: "aether:rendered", id: msg.id, frameIndex: msg.frameIndex, nonce: EXPECTED_NONCE });
        }
      } catch (err) {
        port.postMessage({
          type: "aether:error",
          id: msg.id,
          error: String(err && err.message ? err.message : err),
          nonce: EXPECTED_NONCE
        });
      }
    };
    port.postMessage({ type: "aether:ready", nonce: EXPECTED_NONCE });
  });
})();
</script>
</body>
</html>`;
}

/**
 * Generates a self-contained runnable HTML bundle for 1-click download.
 */
export function compileDownloadBundleHtml(
  job: SceneGraphV1,
  language: LanguageCode,
  customCodeOverride?: { enabled: boolean; kind: "canvas2d" | "svg" | "p5"; code: string },
): string {
  const bundle = buildRenderBundle(job, language, { customCodeOverride });
  const serializedBundle = JSON.stringify(bundle).replace(/<\/script>/gi, "<\\/script>");
  const title = job.project.title[language] || job.project.title["en-US"] || "Aether 2D Bundle";

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Aether Studio v2.0</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #070B16;
    color: #F5F7FF;
    font-family: Inter, system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px;
  }
  .stage-wrap {
    position: relative;
    max-width: 92vw;
    max-height: 78vh;
    border: 1px solid rgba(93, 230, 255, 0.35);
    border-radius: 12px;
    overflow: hidden;
    background: #070B16;
  }
  canvas {
    display: block;
    max-width: 100%;
    max-height: 78vh;
    width: auto;
    height: auto;
  }
  #aether-svg-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(560px, 92vw);
    background: #111A2E;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid rgba(184, 198, 222, 0.2);
  }
  button {
    background: #5DE6FF;
    color: #070B16;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 700;
    cursor: pointer;
  }
  input[type="range"] { flex: 1; accent-color: #5DE6FF; }
  span { font-size: 13px; color: #B8C6DE; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div class="stage-wrap">
  <canvas id="aether-canvas"></canvas>
  <svg id="aether-svg-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
</div>
<div class="bar">
  <button id="toggle">Play</button>
  <input id="scrubber" type="range" min="0" max="1" value="0" />
  <span id="readout">0 / 0</span>
</div>
<script>
${AETHER_RUNTIME_JS}
</script>
<script>
(async function() {
  var bundle = ${serializedBundle};
  var meta = await window.Aether.init(bundle);
  var scrubber = document.getElementById("scrubber");
  var readout = document.getElementById("readout");
  var toggle = document.getElementById("toggle");
  scrubber.max = String(Math.max(0, meta.totalFrames - 1));
  var frame = 0;
  var playing = false;
  var timer = null;

  async function draw(idx) {
    frame = Math.max(0, Math.min(meta.totalFrames - 1, idx));
    scrubber.value = String(frame);
    readout.textContent = frame + " / " + meta.totalFrames;
    await window.Aether.renderAt(frame);
  }

  scrubber.addEventListener("input", function() {
    playing = false;
    toggle.textContent = "Play";
    draw(Number(scrubber.value));
  });

  toggle.addEventListener("click", function() {
    playing = !playing;
    toggle.textContent = playing ? "Pause" : "Play";
    if (playing) {
      var step = async function() {
        if (!playing) return;
        await draw((frame + 1) % meta.totalFrames);
        timer = setTimeout(step, 1000 / bundle.fps);
      };
      step();
    } else if (timer) {
      clearTimeout(timer);
    }
  });

  await draw(0);
})();
</script>
</body>
</html>`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
