import { framesToSrtTimestamp } from "../contracts/timing.ts";
import type { KrTimelineV1 } from "../contracts/schemas.ts";

export function exportTimelineSrt(
  timeline: KrTimelineV1,
  lang: "hi" | "en",
): string {
  const sorted = [...timeline.captions].sort((a, b) => a.in_frame - b.in_frame);
  const blocks: string[] = [];

  sorted.forEach((cap, idx) => {
    const text = lang === "hi" ? cap.hi_text.trim() : cap.en_text.trim();
    if (!text) return;
    const start = framesToSrtTimestamp(cap.in_frame);
    const end = framesToSrtTimestamp(cap.out_frame);
    blocks.push(`${idx + 1}\n${start} --> ${end}\n${text}`);
  });

  return blocks.join("\n\n") + (blocks.length > 0 ? "\n" : "");
}

export function exportTimelineEditBundle(timeline: KrTimelineV1): Record<string, unknown> {
  return {
    schema_version: "kr.export.bundle.v1",
    project_id: timeline.project_id,
    timeline_id: timeline.timeline_id,
    timeline_version: timeline.version,
    fps: timeline.fps,
    sample_rate: timeline.sample_rate,
    total_frames: timeline.total_frames,
    clips: timeline.clips.map((c) => ({
      clip_id: c.clip_id,
      scene_id: c.scene_id,
      in_frame: c.in_frame,
      out_frame: c.out_frame,
      source_in_frame: c.source_in_frame,
      drive_image_id: c.drive_image_id,
      drive_mp4_id: c.drive_mp4_id,
    })),
    stems: timeline.stems,
    srt_hi: exportTimelineSrt(timeline, "hi"),
    srt_en: exportTimelineSrt(timeline, "en"),
  };
}
