import { useEffect, useMemo, useRef, useState } from "react";
import { compileSandboxHtml } from "@/lib/studio/compiler";
import { buildRenderBundle, type AetherRenderBundle } from "@/lib/studio/renderer/runtime";
import type { LanguageCode, SceneGraphV1 } from "@/lib/studio/schema";
import type { CumulativeTimeline } from "@/lib/studio/timing";

interface PreviewFrameProps {
  job: SceneGraphV1;
  language: LanguageCode;
  timeline: CumulativeTimeline;
  frameIndex: number;
  customCode?: {
    enabled: boolean;
    kind: "canvas2d" | "svg" | "p5";
    code: string;
  };
}

interface FontPayload {
  family: string;
  weight: string;
  url: string;
}

const FONT_MANIFEST: FontPayload[] = [
  { family: "Inter", weight: "400", url: "/renderer/fonts/inter-latin-400-normal.woff2" },
  { family: "Inter", weight: "600", url: "/renderer/fonts/inter-latin-600-normal.woff2" },
  { family: "Inter", weight: "700", url: "/renderer/fonts/inter-latin-700-normal.woff2" },
  {
    family: "Space Grotesk",
    weight: "500",
    url: "/renderer/fonts/space-grotesk-latin-500-normal.woff2",
  },
  {
    family: "Space Grotesk",
    weight: "700",
    url: "/renderer/fonts/space-grotesk-latin-700-normal.woff2",
  },
  {
    family: "Noto Sans Devanagari",
    weight: "400",
    url: "/renderer/fonts/noto-sans-devanagari-devanagari-400-normal.woff2",
  },
  {
    family: "Noto Sans Devanagari",
    weight: "600",
    url: "/renderer/fonts/noto-sans-devanagari-devanagari-600-normal.woff2",
  },
  {
    family: "Noto Sans Devanagari",
    weight: "700",
    url: "/renderer/fonts/noto-sans-devanagari-devanagari-700-normal.woff2",
  },
];

let cachedFontBuffers: { family: string; weight: string; buffer: ArrayBuffer }[] | null = null;

async function loadFontBuffers() {
  if (cachedFontBuffers) return cachedFontBuffers;
  const loaded = await Promise.all(
    FONT_MANIFEST.map(async (item) => {
      try {
        const res = await fetch(item.url);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        return { family: item.family, weight: item.weight, buffer };
      } catch {
        return null;
      }
    }),
  );
  cachedFontBuffers = loaded.filter(
    (x): x is { family: string; weight: string; buffer: ArrayBuffer } => x !== null,
  );
  return cachedFontBuffers;
}

function makeNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `nonce_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function PreviewFrame({
  job,
  language,
  timeline,
  frameIndex,
  customCode,
}: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const msgIdRef = useRef(1);
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const nonce = useMemo(() => makeNonce(), []);
  const srcDoc = useMemo(() => compileSandboxHtml(nonce), [nonce]);

  const bundle: AetherRenderBundle = useMemo(
    () =>
      buildRenderBundle(job, language, {
        timeline,
        customCodeOverride: customCode,
      }),
    [job, language, timeline, customCode],
  );

  // Establish MessageChannel bridge whenever iframe loads
  const handleIframeLoad = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    portRef.current?.close();

    const channel = new MessageChannel();
    portRef.current = channel.port1;
    channel.port1.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.nonce !== nonce) return;
      if (msg.type === "aether:ready") {
        setReady(true);
        // Transfer bundled font buffers into sandboxed iframe
        void loadFontBuffers().then((fonts) => {
          const copies = fonts.map((f) => ({
            family: f.family,
            weight: f.weight,
            buffer: f.buffer.slice(0),
          }));
          channel.port1.postMessage(
            { type: "aether:fonts", fonts: copies, nonce },
            copies.map((c) => c.buffer),
          );
        });
      } else if (msg.type === "aether:error") {
        setRenderError(String(msg.error ?? "Sandbox render error"));
      } else if (msg.type === "aether:rendered" || msg.type === "aether:inited") {
        setRenderError(null);
      }
    };
    win.postMessage({ type: "aether:connect", nonce }, "*", [channel.port2]);
  };

  // Send init whenever bundle changes and bridge is ready
  useEffect(() => {
    if (!ready || !portRef.current) return;
    const id = msgIdRef.current++;
    portRef.current.postMessage({ type: "aether:init", id, bundle, nonce });
    const renderId = msgIdRef.current++;
    portRef.current.postMessage({
      type: "aether:render",
      id: renderId,
      frameIndex,
      nonce,
    });
  }, [ready, bundle, nonce, frameIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      portRef.current?.close();
    };
  }, []);

  const isPortrait = job.project.aspect_ratio === "9:16";

  return (
    <div className="relative flex w-full flex-col items-center justify-center rounded-xl border border-slate-700/60 bg-[#070B16] p-3">
      <div
        className={`relative overflow-hidden rounded-lg border border-cyan-400/30 bg-[#070B16] shadow-2xl ${
          isPortrait ? "aspect-[9/16] w-full max-w-[300px]" : "aspect-video w-full max-w-[560px]"
        }`}
      >
        <iframe
          ref={iframeRef}
          title="Aether 2D Deterministic Preview"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          onLoad={handleIframeLoad}
          className="h-full w-full border-0 bg-[#070B16]"
        />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#070B16]/85 text-xs text-slate-300">
            Initializing sandboxed 2D runtime...
          </div>
        )}
      </div>
      {renderError && (
        <div className="mt-2 w-full rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
          Sandbox diagnostic: {renderError}
        </div>
      )}
    </div>
  );
}
