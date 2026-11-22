"""KathaRift Studio — Canonical 24 fps / 48,000 Hz Timing Math (Python parity with timing.ts)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

KR_FPS = 24
KR_SAMPLE_RATE = 48_000
KR_SAMPLES_PER_FRAME = KR_SAMPLE_RATE // KR_FPS  # 2000


@dataclass(frozen=True)
class HalfOpenFrameSpan:
    in_frame: int
    out_frame: int

    def __post_init__(self) -> None:
        if not isinstance(self.in_frame, int) or not isinstance(self.out_frame, int):
            raise ValueError(f"Frame bounds must be integers: {(self.in_frame, self.out_frame)}")
        if self.in_frame < 0:
            raise ValueError(f"in_frame must be >= 0 (got {self.in_frame})")
        if self.out_frame <= self.in_frame:
            raise ValueError(f"Half-open interval requires out_frame > in_frame ({self.in_frame}, {self.out_frame})")

    @property
    def duration_frames(self) -> int:
        return self.out_frame - self.in_frame


def round_half_away_from_zero(value: float) -> int:
    """Match JS Math.round for non-negative numbers: floor(x + 0.5)."""
    if value < 0:
        raise ValueError(f"Expected non-negative value, got {value}")
    return int(value + 0.5)


def samples_to_frames_round(samples: int | float) -> int:
    if samples < 0:
        raise ValueError(f"samples must be >= 0 (got {samples})")
    return round_half_away_from_zero((float(samples) * KR_FPS) / KR_SAMPLE_RATE)


def frames_to_samples(frames: int) -> int:
    if not isinstance(frames, int) or frames < 0:
        raise ValueError(f"frames must be a non-negative integer (got {frames})")
    return round_half_away_from_zero((float(frames) * KR_SAMPLE_RATE) / KR_FPS)


def ms_to_frames_round(ms: int | float) -> int:
    if ms < 0:
        raise ValueError(f"ms must be >= 0 (got {ms})")
    return round_half_away_from_zero((float(ms) * KR_FPS) / 1000.0)


def frames_to_ms(frames: int) -> int:
    if not isinstance(frames, int) or frames < 0:
        raise ValueError(f"frames must be a non-negative integer (got {frames})")
    return round_half_away_from_zero((float(frames) * 1000.0) / KR_FPS)


def allocate_cumulative_frame_spans(
    sample_counts: Iterable[int],
    min_frames_per_scene: int = 24,
) -> List[HalfOpenFrameSpan]:
    spans: List[HalfOpenFrameSpan] = []
    cumulative_samples = 0
    prev_end_frame = 0

    for raw_count in sample_counts:
        count = max(0, int(round(raw_count)))
        cumulative_samples += count
        raw_end_frame = samples_to_frames_round(cumulative_samples)
        end_frame = max(prev_end_frame + min_frames_per_scene, raw_end_frame)
        spans.append(HalfOpenFrameSpan(in_frame=prev_end_frame, out_frame=end_frame))
        prev_end_frame = end_frame
    return spans


def frames_to_srt_timestamp(frame: int) -> str:
    total_ms = max(0, frames_to_ms(max(0, int(round(frame)))))
    hours = total_ms // 3_600_000
    minutes = (total_ms % 3_600_000) // 60_000
    seconds = (total_ms % 60_000) // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
