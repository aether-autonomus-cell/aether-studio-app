import { createFileRoute } from "@tanstack/react-router";
import { fetchWorkerMp4, fetchWorkerPreview } from "@/lib/studio/api";

export const Route = createFileRoute("/api/studio/mp4")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Missing download request." }, { status: 400 });
        }
        const kind = body && typeof body === "object" && (body as { kind?: unknown }).kind === "preview" ? "preview" : "full";
        const result = kind === "preview" ? await fetchWorkerPreview(body) : await fetchWorkerMp4(body);
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
        const payload = new Uint8Array(result.bytes.byteLength);
        payload.set(result.bytes);
        return new Response(payload, {
          headers: {
            "Content-Type": result.contentType || "video/mp4",
            "Content-Disposition": kind === "preview" ? "inline" : 'attachment; filename="aether.mp4"',
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});