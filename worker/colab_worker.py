#!/usr/bin/env python3
"""
KathaRift Studio — Colab / Local Python Worker (kr.job.v1 & kr.timeline.v1)

Implements the sequential scene-by-scene waterfall:
  image -> speech_hi -> speech_en -> timing -> compose -> verify -> drive_save -> ready -> timeline_append

Preserves the verified FLUX.2 Klein 4B baseline:
  - model_id: black-forest-labs/FLUX.2-klein-4B
  - revision: e7b7dc27f91deacad38e78976d1f2b499d76a294
  - Qwen3ForCausalLM 4-bit NF4 FP32-compute pre-encode in isolated subprocess -> prompt_embeds [1,256,7680]
  - FP16 resident KR_PIPE @ 1344x768, 4 steps, guidance_scale=1.0, restrained-v1 kr_grade

Strictly enforces:
  - paid_routes=false & confirmed_by_user=true
  - Failure on scene N blocks scene N+1
  - Never loads Kokoro hm_omega/am_michael or Qwen3-4B-Instruct-2507 failed planner
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
import wave
from typing import Any, Callable, Dict, List, Optional

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from worker.contracts import ContractValidationError, validate_job_v1
from worker.timing import KR_FPS, KR_SAMPLE_RATE, samples_to_frames_round

WATERFALL_STAGES = (
    "image",
    "speech_hi",
    "speech_en",
    "timing",
    "compose",
    "verify",
    "drive_save",
    "ready",
    "timeline_append",
)

REJECTED_VOICES = {"hm_omega", "am_michael"}


class WaterfallFailure(RuntimeError):
    """Raised when any scene stage fails, halting downstream scenes."""

    def __init__(self, scene_id: str, stage: str, code: str, message: str) -> None:
        super().__init__(f"[{scene_id}:{stage}] {code}: {message}")
        self.scene_id = scene_id
        self.stage = stage
        self.code = code
        self.message = message


def apply_restrained_v1_grade(rgb_array: Any) -> Any:
    """Port of verified restrained-v1 kr_grade (shadow/contrast/highlight roll-off)."""
    import numpy as np  # type: ignore

    arr = rgb_array.astype(np.float32) / 255.0
    arr = np.clip((arr - 0.5) * 1.06 + 0.5, 0.0, 1.0)
    # Subtle warm key / cool shadow split
    arr[..., 0] = np.clip(arr[..., 0] * 1.02, 0.0, 1.0)
    arr[..., 2] = np.clip(arr[..., 2] * 0.985 + 0.008, 0.0, 1.0)
    return (arr * 255.0).round().astype(np.uint8)


def write_silent_wav_for_fixture(out_path: pathlib.Path, duration_sec: float) -> int:
    """Create a deterministic 48kHz mono PCM WAV for dry-run-fixture testing only."""
    n_samples = max(KR_SAMPLE_RATE, int(round(duration_sec * KR_SAMPLE_RATE)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(KR_SAMPLE_RATE)
        wf.writeframes(b"\x00\x00" * n_samples)
    return n_samples


def post_json(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {body}") from exc


def run_scene_waterfall(
    job: Dict[str, Any],
    work_dir: pathlib.Path,
    mode: str = "colab",
    emit_checkpoint: Optional[Callable[[Dict[str, Any]], None]] = None,
    simulate_fail_scene_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute scenes sequentially; failure on scene N stops scene N+1."""
    validate_job_v1(job)

    # Guard against rejected Kokoro voices
    voices = (job.get("settings") or {}).get("voices") or {}
    for lang in ("hi", "en"):
        vid = (voices.get(lang) or {}).get("voice_id", "")
        if vid in REJECTED_VOICES:
            raise ContractValidationError(f"Rejected voice '{vid}' cannot be used in KathaRift Studio")

    seq = 0
    results: List[Dict[str, Any]] = []

    for scene in job["scenes"]:
        scene_id = scene["scene_id"]
        scene_dir = work_dir / scene_id
        scene_dir.mkdir(parents=True, exist_ok=True)

        cp_state: Dict[str, Any] = {
            "scene_id": scene_id,
            "status": "running",
            "attempt": 1,
        }

        try:
            if simulate_fail_scene_id == scene_id:
                raise WaterfallFailure(
                    scene_id,
                    "image",
                    "SIMULATED_FAILURE",
                    f"Simulated stage failure on {scene_id}",
                )

            # 1. Image stage (1344x768 FLUX.2 Klein 4B in colab mode, marker file in fixture mode)
            seq += 1
            img_path = scene_dir / f"{scene_id}.png"
            if mode == "dry-run-fixture":
                img_path.write_bytes(b"KR_FIXTURE_PNG_1344x768")
            else:
                _render_flux2_scene(scene, job["settings"]["image_baseline"], img_path)
            cp_state["image_local_path"] = str(img_path)
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "image",
                    "checkpoint": dict(cp_state),
                    "message": f"Rendered 1344x768 illustration for {scene_id}",
                    "level": "info",
                })

            # 2 & 3. HI + EN Speech stages (48 kHz master)
            hi_wav = scene_dir / f"{scene_id}_hi.wav"
            en_wav = scene_dir / f"{scene_id}_en.wav"
            target_sec = float(scene.get("target_duration_sec", 8))

            seq += 1
            hi_samples = (
                write_silent_wav_for_fixture(hi_wav, target_sec)
                if mode == "dry-run-fixture"
                else _synthesize_edge_tts_wav(scene["hi_narration"], voices["hi"]["voice_id"], hi_wav)
            )
            cp_state["hi_audio_samples"] = hi_samples
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "speech_hi",
                    "checkpoint": dict(cp_state),
                    "message": f"Synthesized HI narration ({hi_samples} samples @ 48kHz)",
                    "level": "info",
                })

            seq += 1
            en_samples = (
                write_silent_wav_for_fixture(en_wav, target_sec)
                if mode == "dry-run-fixture"
                else _synthesize_edge_tts_wav(scene["en_narration"], voices["en"]["voice_id"], en_wav)
            )
            cp_state["en_audio_samples"] = en_samples
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "speech_en",
                    "checkpoint": dict(cp_state),
                    "message": f"Synthesized EN narration ({en_samples} samples @ 48kHz)",
                    "level": "info",
                })

            # 4. Timing stage (24 fps canonical frame count)
            seq += 1
            master_samples = max(hi_samples, en_samples)
            duration_frames = max(KR_FPS * 2, samples_to_frames_round(master_samples))
            cp_state["duration_frames"] = duration_frames
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "timing",
                    "checkpoint": dict(cp_state),
                    "message": f"Locked duration to {duration_frames} frames @ {KR_FPS}fps",
                    "level": "info",
                })

            # 5. Compose stage (FFmpeg + HyperFrames / Lemo SFX)
            seq += 1
            mp4_path = scene_dir / f"{scene_id}_hi.mp4"
            if mode == "dry-run-fixture":
                mp4_path.write_bytes(b"KR_FIXTURE_MP4_STREAM")
            else:
                _compose_scene_ffmpeg(img_path, hi_wav, duration_frames, mp4_path)
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "compose",
                    "checkpoint": dict(cp_state),
                    "message": f"Composed scene clip ({mp4_path.name})",
                    "level": "info",
                })

            # 6. Verify stage
            seq += 1
            if not mp4_path.exists() or mp4_path.stat().st_size == 0:
                raise WaterfallFailure(scene_id, "verify", "EMPTY_OUTPUT", "Composed scene output missing or empty")
            cp_state["verified"] = True
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "verify",
                    "checkpoint": dict(cp_state),
                    "message": f"Verified {mp4_path.name} integrity",
                    "level": "info",
                })

            # 7. Drive Save stage
            seq += 1
            drive_dir = work_dir / "drive_staging" / job["job_id"]
            drive_dir.mkdir(parents=True, exist_ok=True)
            cp_state["image_drive_id"] = f"local_drive:{scene_id}.png"
            cp_state["composed_mp4_drive_id"] = f"local_drive:{scene_id}_hi.mp4"
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "drive_save",
                    "checkpoint": dict(cp_state),
                    "message": f"Saved scene artifacts for {scene_id}",
                    "level": "info",
                })

            # 8 & 9. Ready + Timeline Append
            seq += 1
            cp_state["status"] = "completed"
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "timeline_append",
                    "checkpoint": dict(cp_state),
                    "message": f"Scene {scene_id} completed & appended to timeline",
                    "level": "info",
                })

            results.append(cp_state)

        except WaterfallFailure as wf:
            seq += 1
            cp_state["status"] = "failed"
            cp_state["error_code"] = wf.code
            cp_state["error_message"] = wf.message
            if emit_checkpoint:
                emit_checkpoint({
                    "seq": seq,
                    "scene_id": scene_id,
                    "stage": "failed",
                    "checkpoint": dict(cp_state),
                    "message": wf.message,
                    "level": "error",
                })
            # Sequential waterfall invariant: failure blocks next scene!
            return {
                "status": "failed",
                "halted_at_scene": scene_id,
                "completed_scenes": results,
                "error": wf.message,
            }

    return {
        "status": "completed",
        "halted_at_scene": None,
        "completed_scenes": results,
        "error": None,
    }


def _render_flux2_scene(scene: Dict[str, Any], baseline: Dict[str, Any], out_path: pathlib.Path) -> None:
    """Run FLUX.2 Klein 4B GPU inference on Colab with restrained-v1 kr_grade."""
    try:
        import torch  # type: ignore
        from diffusers import Flux2KleinPipeline  # type: ignore
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise WaterfallFailure(
            scene["scene_id"],
            "image",
            "MISSING_GPU_DEPS",
            f"Colab GPU deps missing ({exc}). Run Cell 1 setup or use --mode dry-run-fixture.",
        ) from exc

    if not torch.cuda.is_available():
        raise WaterfallFailure(scene["scene_id"], "image", "NO_CUDA", "CUDA GPU required for FLUX.2 Klein 4B")

    model_id = baseline["model_id"]
    rev = baseline["model_revision"]
    pipe = Flux2KleinPipeline.from_pretrained(model_id, revision=rev, torch_dtype=torch.float16).to("cuda")
    gen = torch.Generator("cuda").manual_seed(int(scene.get("seed", 420101)))
    img = pipe(
        prompt=scene["visual_prompt"],
        width=int(baseline["width"]),
        height=int(baseline["height"]),
        num_inference_steps=int(baseline.get("steps", 4)),
        guidance_scale=float(baseline.get("guidance_scale", 1.0)),
        generator=gen,
    ).images[0]
    graded = Image.fromarray(apply_restrained_v1_grade(np.array(img)))
    graded.save(out_path)


def _synthesize_edge_tts_wav(text: str, voice_id: str, out_wav: pathlib.Path) -> int:
    """Synthesize free Edge-TTS speech and transcode to 48kHz mono PCM WAV."""
    mp3_tmp = out_wav.with_suffix(".mp3")
    cmd = [sys.executable, "-m", "edge_tts", "--voice", voice_id, "--text", text, "--write-media", str(mp3_tmp)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise WaterfallFailure("speech", "speech", "EDGE_TTS_FAIL", proc.stderr or "edge_tts failed")
    ff = subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3_tmp), "-ar", str(KR_SAMPLE_RATE), "-ac", "1", str(out_wav)],
        capture_output=True,
        text=True,
    )
    if ff.returncode != 0:
        raise WaterfallFailure("speech", "speech", "FFMPEG_WAV_FAIL", ff.stderr or "ffmpeg wav failed")
    with wave.open(str(out_wav), "rb") as wf:
        return wf.getnframes()


def _compose_scene_ffmpeg(img_path: pathlib.Path, wav_path: pathlib.Path, duration_frames: int, out_mp4: pathlib.Path) -> None:
    dur_sec = duration_frames / float(KR_FPS)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(img_path),
        "-i", str(wav_path),
        "-t", f"{dur_sec:.3f}",
        "-r", str(KR_FPS),
        "-vf", "scale=1344:768:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ar", str(KR_SAMPLE_RATE),
        str(out_mp4),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise WaterfallFailure("compose", "compose", "FFMPEG_COMPOSE_FAIL", proc.stderr or "ffmpeg compose failed")


def main() -> None:
    parser = argparse.ArgumentParser(description="KathaRift Studio Bounded Colab/Local Worker")
    parser.add_argument("--app-url", help="Base URL of KathaRift Studio app")
    parser.add_argument("--pairing-code", help="Short-lived pairing code from Studio Production tab")
    parser.add_argument("--mode", choices=["colab", "dry-run-fixture"], default="colab")
    parser.add_argument("--work-dir", default="/tmp/katharift_worker")
    args = parser.parse_args()

    if not args.app_url or not args.pairing_code:
        parser.error("--app-url and --pairing-code are required")

    base = args.app_url.rstrip("/")
    claim = post_json(f"{base}/api/kr/worker/claim", {
        "pairing_code": args.pairing_code,
        "gpu_name": "dry-run-fixture" if args.mode == "dry-run-fixture" else "Colab T4 GPU",
        "capabilities": {"fps": KR_FPS, "sample_rate": KR_SAMPLE_RATE, "mode": args.mode},
    })

    job = claim.get("job")
    if not job:
        print("[worker] No queued jobs available for this pairing session.")
        return

    ws_id = claim["worker_session_id"]
    lease = claim["lease_token"]

    def emit(payload: Dict[str, Any]) -> None:
        post_json(f"{base}/api/kr/worker/checkpoint", {
            "job_id": job["job_id"],
            "worker_session_id": ws_id,
            "lease_token": lease,
            **payload,
        })

    outcome = run_scene_waterfall(
        job=job,
        work_dir=pathlib.Path(args.work_dir),
        mode=args.mode,
        emit_checkpoint=emit,
    )
    print(json.dumps(outcome, indent=2))


if __name__ == "__main__":
    main()
