"""FFmpeg video/audio muxing, sidechain BGM ducking, ffprobe verification,
SHA-256 digest computation, and credits/render-report generation.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def probe_media(path: Path) -> dict[str, Any]:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        text=True,
    )
    info = json.loads(out)
    video_stream = next(
        (s for s in info.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    audio_stream = next(
        (s for s in info.get("streams", []) if s.get("codec_type") == "audio"),
        None,
    )
    if not video_stream or not audio_stream:
        raise RuntimeError(f"Verified MP4 missing video or audio stream: {path}")

    duration = float(info.get("format", {}).get("duration", 0.0))
    return {
        "duration_sec": round(duration, 3),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "video_codec": video_stream.get("codec_name"),
        "audio_codec": audio_stream.get("codec_name"),
        "sample_rate": int(audio_stream.get("sample_rate", 48000)),
        "nb_frames": int(video_stream.get("nb_frames", 0) or 0),
    }


def _synthesize_procedural_bgm(track_id: str, duration_sec: float, out_wav: Path) -> Path:
    freq_base = 110 if "obsidian" in track_id else 146
    expr = (
        f"aevalsrc='0.18*sin(2*PI*{freq_base}*t)+0.09*sin(2*PI*{freq_base * 1.5}*t)"
        f"*sin(2*PI*0.5*t)':d={duration_sec:.3f}:s=48000"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", expr, str(out_wav)],
        check=True,
    )
    return out_wav


def mux_video_and_audio(
    video_mp4: Path,
    voice_wav: Path,
    out_mp4: Path,
    duration_sec: float,
    bgm_path: Path | None = None,
    bgm_track_id: str | None = None,
    bgm_volume: float = 0.14,
) -> dict[str, Any]:
    effective_bgm = bgm_path
    if effective_bgm is None and bgm_track_id:
        effective_bgm = _synthesize_procedural_bgm(
            bgm_track_id,
            duration_sec,
            out_mp4.with_suffix(".bgm.wav"),
        )

    if effective_bgm and effective_bgm.exists():
        d_str = f"{duration_sec:.3f}"
        filter_complex = (
            f"[1:a]apad,atrim=duration={d_str},asplit=2[voice][sc];"
            f"[2:a]atrim=duration={d_str},asetpts=PTS-STARTPTS,volume={bgm_volume:.3f}[bg];"
            f"[bg][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=250[duck];"
            f"[voice][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]"
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_mp4),
            "-i",
            str(voice_wav),
            "-stream_loop",
            "-1",
            "-i",
            str(effective_bgm),
            "-filter_complex",
            filter_complex,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            str(out_mp4),
        ]
    else:
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_mp4),
            "-i",
            str(voice_wav),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            str(out_mp4),
        ]

    subprocess.run(cmd, check=True)
    probe = probe_media(out_mp4)
    digest = sha256_file(out_mp4)
    return {
        "filename": out_mp4.name,
        "sha256": digest,
        "bytes": out_mp4.stat().st_size,
        **probe,
    }


def write_credits_file(job: dict[str, Any], out_path: Path) -> None:
    project = job["project"]
    lines = [
        "Aether Studio v2.0 — Export Attribution & Credits",
        f"Project ID: {job['project_id']} (rev {job['project_revision']})",
        f"Style Manifest: {project.get('style_id', 'midnight-cyan@1')}",
        f"Visual Mode: {project.get('visual_mode', 'pure-2d')}",
        "",
        "Fonts: Inter, Space Grotesk, Noto Sans Devanagari (SIL Open Font License 1.1)",
        "Speech Synthesis: Microsoft Edge-TTS (hi-IN-MadhurNeural / en-US-ChristopherNeural)",
        "Engine: Aether Studio 2D Deterministic Renderer + Playwright + FFmpeg",
    ]
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
