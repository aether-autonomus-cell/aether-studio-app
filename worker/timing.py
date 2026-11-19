"""Deterministic cumulative PCM sample -> integer frame boundary math.
Must match src/lib/studio/timing.ts bit-for-bit.
"""

from __future__ import annotations

from typing import Any

PCM_SAMPLE_RATE = 48_000


def compute_cumulative_boundaries(durations_samples: list[int], fps: int) -> list[int]:
    boundaries: list[int] = [0]
    cumulative = 0
    for raw in durations_samples:
        samples = max(0, int(round(raw)))
        cumulative += samples
        raw_frame = int(round((cumulative * fps) / PCM_SAMPLE_RATE))
        prev = boundaries[-1]
        frame = max(prev + 1, raw_frame) if samples > 0 else prev
        boundaries.append(frame)
    return boundaries


def build_timeline_from_speech(
    scene_audios: list[dict[str, Any]],
    fps: int,
) -> dict[str, Any]:
    totals = [
        max(0, int(round(s["speech_samples"]))) + max(0, int(round(s["pause_samples"])))
        for s in scene_audios
    ]
    boundaries = compute_cumulative_boundaries(totals, fps)
    scenes: list[dict[str, Any]] = []
    cumulative_samples = 0

    for idx, item in enumerate(scene_audios):
        speech_samples = max(0, int(round(item["speech_samples"])))
        pause_samples = max(0, int(round(item["pause_samples"])))
        start_sample = cumulative_samples
        speech_end_sample = start_sample + speech_samples
        end_sample = speech_end_sample + pause_samples
        cumulative_samples = end_sample

        start_frame = boundaries[idx]
        end_frame = boundaries[idx + 1]
        raw_speech_end = int(round((speech_end_sample * fps) / PCM_SAMPLE_RATE))
        speech_end_frame = max(start_frame, min(end_frame, raw_speech_end))

        scenes.append(
            {
                "id": item["id"],
                "index": idx,
                "startSample": start_sample,
                "speechEndSample": speech_end_sample,
                "endSample": end_sample,
                "startFrame": start_frame,
                "speechEndFrame": speech_end_frame,
                "endFrame": end_frame,
                "frameCount": max(1, end_frame - start_frame),
                "speechDurationSec": speech_samples / PCM_SAMPLE_RATE,
                "totalDurationSec": (speech_samples + pause_samples) / PCM_SAMPLE_RATE,
            }
        )

    total_frames = max(1, boundaries[-1] if boundaries else 1)
    return {
        "fps": fps,
        "sampleRate": PCM_SAMPLE_RATE,
        "totalSamples": cumulative_samples,
        "totalFrames": total_frames,
        "totalDurationSec": cumulative_samples / PCM_SAMPLE_RATE,
        "boundaries": boundaries,
        "scenes": scenes,
    }
