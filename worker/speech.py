"""Speech-first Edge-TTS synthesis, 48 kHz PCM measurement, silent pause padding,
and SRT/VTT caption generation for Aether Studio v2.0.
"""

from __future__ import annotations

import asyncio
import math
import struct
import subprocess
import wave
from pathlib import Path
from typing import Any

from worker.timing import PCM_SAMPLE_RATE

DEFAULT_VOICES = {
    "hi-IN": "hi-IN-MadhurNeural",
    "en-US": "en-US-ChristopherNeural",
}


async def _verify_voices_async(voices: list[str]) -> dict[str, bool]:
    import edge_tts

    available = await edge_tts.list_voices()
    names = {v.get("ShortName") for v in available}
    return {voice: (voice in names) for voice in voices}


def verify_voices(voices: list[str]) -> dict[str, bool]:
    return asyncio.run(_verify_voices_async(voices))


async def _synthesize_one(text: str, voice: str, out_mp3: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(str(out_mp3))


def _decode_to_48k_pcm_wav(src_audio: Path, dst_wav: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(src_audio),
            "-ac",
            "1",
            "-ar",
            str(PCM_SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(dst_wav),
        ],
        check=True,
    )


def _write_silence_wav(dst_wav: Path, samples: int) -> None:
    with wave.open(str(dst_wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(PCM_SAMPLE_RATE)
        wf.writeframes(b"\x00\x00" * max(0, samples))


def _read_wav_pcm(wav_path: Path) -> tuple[bytes, int]:
    with wave.open(str(wav_path), "rb") as wf:
        frames = wf.getnframes()
        raw = wf.readframes(frames)
    return raw, frames


def _compute_frame_envelopes(pcm_bytes: bytes, fps: int, total_frames: int) -> list[float]:
    samples_per_frame = max(1, PCM_SAMPLE_RATE // fps)
    total_samples = len(pcm_bytes) // 2
    envelopes: list[float] = []
    for f in range(total_frames):
        s0 = f * samples_per_frame
        s1 = min(total_samples, (f + 1) * samples_per_frame)
        if s1 <= s0:
            envelopes.append(0.0)
            continue
        chunk = pcm_bytes[s0 * 2 : s1 * 2]
        vals = struct.unpack(f"<{len(chunk) // 2}h", chunk)
        rms = math.sqrt(sum(v * v for v in vals) / max(1, len(vals))) / 32768.0
        envelopes.append(round(min(1.0, rms * 3.8), 4))
    return envelopes


def _fmt_srt_ts(sec: float) -> str:
    ms_total = max(0, int(round(sec * 1000)))
    h = ms_total // 3_600_000
    m = (ms_total % 3_600_000) // 60_000
    s = (ms_total % 60_000) // 1000
    ms = ms_total % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _fmt_vtt_ts(sec: float) -> str:
    return _fmt_srt_ts(sec).replace(",", ".")


def synthesize_language_track(
    job: dict[str, Any],
    language: str,
    work_dir: Path,
) -> dict[str, Any]:
    project = job["project"]
    scenes = project["scenes"]
    fps = int(project.get("fps", 30))
    voice = project.get("voices", {}).get(language) or DEFAULT_VOICES.get(
        language, "en-US-ChristopherNeural"
    )
    fallback_lang = "en-US" if language == "hi-IN" else "hi-IN"

    speech_dir = work_dir / f"speech_{language}"
    speech_dir.mkdir(parents=True, exist_ok=True)

    scene_audios: list[dict[str, Any]] = []
    combined_pcm = bytearray()
    envelopes_by_scene: dict[str, list[float]] = {}
    caption_entries: list[tuple[float, float, str]] = []

    cursor_samples = 0
    for idx, scene in enumerate(scenes):
        sid = scene["id"]
        narration = scene.get("narration", {})
        text = (narration.get(language) or narration.get(fallback_lang) or "").strip()
        pause_ms = int(scene.get("pause_after_ms", 280))
        pause_samples = int(round((max(0, pause_ms) / 1000.0) * PCM_SAMPLE_RATE))

        raw_wav = speech_dir / f"{idx:03d}_{sid}.wav"
        if text:
            mp3_path = speech_dir / f"{idx:03d}_{sid}.mp3"
            asyncio.run(_synthesize_one(text, voice, mp3_path))
            _decode_to_48k_pcm_wav(mp3_path, raw_wav)
        else:
            hint_sec = float(scene.get("duration_hint_sec", 4.0))
            _write_silence_wav(raw_wav, int(round(hint_sec * PCM_SAMPLE_RATE)))

        pcm_bytes, speech_samples = _read_wav_pcm(raw_wav)
        combined_pcm.extend(pcm_bytes)
        if pause_samples > 0:
            combined_pcm.extend(b"\x00\x00" * pause_samples)

        total_scene_samples = speech_samples + pause_samples
        scene_frames = max(1, int(round((total_scene_samples * fps) / PCM_SAMPLE_RATE)))
        envelopes_by_scene[sid] = _compute_frame_envelopes(pcm_bytes, fps, scene_frames)

        start_sec = cursor_samples / PCM_SAMPLE_RATE
        end_sec = (cursor_samples + speech_samples) / PCM_SAMPLE_RATE
        cursor_samples += total_scene_samples
        if text:
            caption_entries.append((start_sec, max(start_sec + 0.5, end_sec), text))

        scene_audios.append(
            {
                "id": sid,
                "speech_samples": speech_samples,
                "pause_samples": pause_samples,
            }
        )

    master_wav = work_dir / f"voice_{language}.wav"
    with wave.open(str(master_wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(PCM_SAMPLE_RATE)
        wf.writeframes(bytes(combined_pcm))

    lang_short = "hi" if language == "hi-IN" else "en"
    srt_path = work_dir / f"captions_{lang_short}.srt"
    vtt_path = work_dir / f"captions_{lang_short}.vtt"

    srt_lines: list[str] = []
    vtt_lines: list[str] = ["WEBVTT", ""]
    for i, (st, en, txt) in enumerate(caption_entries, start=1):
        srt_lines.extend([str(i), f"{_fmt_srt_ts(st)} --> {_fmt_srt_ts(en)}", txt, ""])
        vtt_lines.extend([f"{_fmt_vtt_ts(st)} --> {_fmt_vtt_ts(en)}", txt, ""])

    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
    vtt_path.write_text("\n".join(vtt_lines), encoding="utf-8")

    return {
        "voice": voice,
        "master_wav": str(master_wav),
        "srt_path": str(srt_path),
        "vtt_path": str(vtt_path),
        "scene_audios": scene_audios,
        "envelopes_by_scene": envelopes_by_scene,
    }
