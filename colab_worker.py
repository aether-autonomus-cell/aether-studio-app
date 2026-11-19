"""Aether Studio v2.0 — Modular Colab CLI Orchestrator (Preflight, Render, Publish).
Zero 24/7 tunnels or background daemons. Bounded per-job interactive execution.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

from worker import api as cloud_api
from worker.backdrop_hybrid import generate_hybrid_backdrops
from worker.drive import drive_export_dir, ensure_drive_mounted, save_artifacts_to_drive
from worker.mux import mux_video_and_audio, write_credits_file
from worker.publish import resumable_upload_mp4
from worker.speech import synthesize_language_track, verify_voices
from worker.timing import build_timeline_from_speech

ROOT_DIR = Path(__file__).resolve().parent
WORK_ROOT = Path("/content/aether_work") if Path("/content").exists() else ROOT_DIR / ".aether_work"

WORKER_FILES = [
    "worker/__init__.py",
    "worker/api.py",
    "worker/speech.py",
    "worker/timing.py",
    "worker/backdrop_hybrid.py",
    "worker/render_browser.py",
    "worker/mux.py",
    "worker/drive.py",
    "worker/publish.py",
]

RENDERER_FILES = [
    "public/renderer/index.html",
    "public/renderer/aether-runtime.js",
    "public/renderer/fonts/fonts.css",
    "public/renderer/fonts/inter-latin-400-normal.woff2",
    "public/renderer/fonts/inter-latin-600-normal.woff2",
    "public/renderer/fonts/inter-latin-700-normal.woff2",
    "public/renderer/fonts/space-grotesk-latin-500-normal.woff2",
    "public/renderer/fonts/space-grotesk-latin-700-normal.woff2",
    "public/renderer/fonts/noto-sans-devanagari-devanagari-400-normal.woff2",
    "public/renderer/fonts/noto-sans-devanagari-devanagari-600-normal.woff2",
    "public/renderer/fonts/noto-sans-devanagari-devanagari-700-normal.woff2",
    "shared/scene-graph.schema.json",
]

STRIPPED_ENV_KEYS = (
    "AETHER_TOKEN",
    "AETHER_CAPABILITY_TOKEN",
    "GOOGLE_OAUTH_TOKEN",
    "YOUTUBE_TOKEN",
    "DATABASE_URL",
)


def _download_files(base_url: str, rel_paths: list[str]) -> None:
    base = base_url.rstrip("/")
    for rel in rel_paths:
        dst = ROOT_DIR / rel
        if dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        url = f"{base}/{rel}"
        print(f"[preflight] fetching {rel}...", flush=True)
        data = urllib.request.urlopen(url, timeout=30).read()
        dst.write_bytes(data)


def cmd_preflight(base_url: str | None) -> None:
    if base_url:
        _download_files(base_url, WORKER_FILES + RENDERER_FILES)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-q",
            "edge-tts==7.0.0",
            "playwright==1.51.0",
            "jsonschema==4.23.0",
        ],
        check=True,
    )
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        subprocess.run(["apt-get", "update", "-qq"], check=False)
        subprocess.run(["apt-get", "install", "-y", "-qq", "ffmpeg"], check=True)

    voices = verify_voices(["hi-IN-MadhurNeural", "en-US-ChristopherNeural"])
    print("[preflight] Voices verified:", voices, flush=True)
    if ensure_drive_mounted():
        print("[preflight] Google Drive mounted.", flush=True)
    else:
        print("[preflight] Google Drive not mounted (local outputs remain in work dir).", flush=True)


def _validate_job_schema(job: dict[str, Any]) -> None:
    schema_path = ROOT_DIR / "shared" / "scene-graph.schema.json"
    if not schema_path.exists():
        return
    try:
        import jsonschema

        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(instance=job, schema=schema)
    except ImportError:
        pass


def _dimensions(aspect_ratio: str, resolution: str) -> tuple[int, int]:
    if aspect_ratio == "9:16":
        return (1080, 1920) if resolution == "1080p" else (540, 960)
    return (1920, 1080) if resolution == "1080p" else (960, 540)


def _run_isolated_browser_render(
    bundle_path: Path,
    public_dir: Path,
    out_video_mp4: Path,
    ckpt_dir: Path | None,
) -> None:
    clean_env = {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV_KEYS}
    clean_env["PYTHONPATH"] = str(ROOT_DIR)
    args = [
        sys.executable,
        "-m",
        "worker.render_browser",
        str(bundle_path),
        str(public_dir),
        str(out_video_mp4),
    ]
    if ckpt_dir is not None:
        args.append(str(ckpt_dir))
    subprocess.run(args, env=clean_env, check=True)


def cmd_render(
    job_path: Path | None,
    origin: str | None,
    pair_code: str | None,
) -> None:
    capability_token = ""
    if origin and pair_code:
        claimed = cloud_api.claim_job(origin, pair_code)
        job = claimed["packet"]
        capability_token = claimed["capability_token"]
    elif job_path:
        job = json.loads(job_path.read_text(encoding="utf-8"))
    else:
        raise SystemExit("Provide --job <aether_job.json> or --origin + --pair-code")

    _validate_job_schema(job)
    project = job["project"]
    project_id = job["project_id"]
    work_dir = WORK_ROOT / project_id
    work_dir.mkdir(parents=True, exist_ok=True)
    public_dir = ROOT_DIR / "public"

    save_drive = bool(project.get("outputs", {}).get("save_to_drive", True))
    drive_folder = project.get("outputs", {}).get("drive_folder", "AetherStudioExports")
    if save_drive:
        ensure_drive_mounted()

    cloud_api.send_heartbeat(origin or "", capability_token, "SPEECH", "Generating Edge-TTS tracks")
    hybrid_backdrops = generate_hybrid_backdrops(job, work_dir)

    width, height = _dimensions(
        project.get("aspect_ratio", "9:16"),
        project.get("resolution", "1080p"),
    )
    fps = int(project.get("fps", 30))
    languages = project.get("languages", ["hi-IN", "en-US"])

    report_artifacts: dict[str, Any] = {}
    timings_out: dict[str, Any] = {}
    artifacts_to_save: list[Path] = []
    ckpt_dir = drive_export_dir(drive_folder, project_id) if save_drive else None

    for lang in languages:
        lang_short = "hi" if lang == "hi-IN" else "en"
        speech_info = synthesize_language_track(job, lang, work_dir)
        timeline = build_timeline_from_speech(speech_info["scene_audios"], fps)
        timings_out[lang] = timeline

        cloud_api.send_heartbeat(
            origin or "",
            capability_token,
            "TIMING",
            f"Computed {timeline['totalFrames']} frames for {lang}",
        )

        bundle = {
            "job": job,
            "language": lang,
            "width": width,
            "height": height,
            "fps": fps,
            "totalFrames": timeline["totalFrames"],
            "timeline": timeline,
            "hybridBackdrops": hybrid_backdrops,
            "speechEnvelopes": speech_info["envelopes_by_scene"],
        }
        bundle_path = work_dir / f"bundle_{lang_short}.json"
        bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

        raw_video_mp4 = work_dir / f"video_only_{lang_short}.mp4"
        cloud_api.send_heartbeat(
            origin or "",
            capability_token,
            "RENDERING",
            f"Rendering {lang} frames in isolated Chromium",
        )
        _run_isolated_browser_render(bundle_path, public_dir, raw_video_mp4, ckpt_dir)

        cloud_api.send_heartbeat(origin or "", capability_token, "MUXING", f"Muxing {lang} MP4")
        final_mp4 = work_dir / f"output_{lang_short}.mp4"
        bgm = project.get("bgm")
        mux_info = mux_video_and_audio(
            video_mp4=raw_video_mp4,
            voice_wav=Path(speech_info["master_wav"]),
            out_mp4=final_mp4,
            duration_sec=float(timeline["totalDurationSec"]),
            bgm_track_id=bgm.get("track_id") if bgm else None,
            bgm_volume=float(bgm.get("volume", 0.14)) if bgm else 0.14,
        )
        report_artifacts[lang] = mux_info
        artifacts_to_save.extend(
            [final_mp4, Path(speech_info["srt_path"]), Path(speech_info["vtt_path"])]
        )

    timing_path = work_dir / "timing.json"
    timing_path.write_text(json.dumps(timings_out, indent=2), encoding="utf-8")
    credits_path = work_dir / "credits.txt"
    write_credits_file(job, credits_path)

    report = {
        "schema_version": "aether.2d.report@1",
        "project_id": project_id,
        "project_revision": job.get("project_revision", 1),
        "artifacts": report_artifacts,
    }
    report_path = work_dir / "render-report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    artifacts_to_save.extend([timing_path, credits_path, report_path])

    cloud_api.send_heartbeat(origin or "", capability_token, "VERIFYING", "Verified via ffprobe")
    if save_drive:
        saved_paths = save_artifacts_to_drive(artifacts_to_save, drive_folder, project_id)
        report["drive_paths"] = saved_paths
        print("[render] Saved to Google Drive:", saved_paths, flush=True)

    cloud_api.complete_job(origin or "", capability_token, "saved", report)
    print(json.dumps(report, indent=2), flush=True)


def cmd_publish(manifest_path: Path, work_dir_override: Path | None) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    project_id = manifest["project_id"]
    drive_folder = manifest.get("drive_folder", "AetherStudioExports")
    work_dir = work_dir_override or (WORK_ROOT / project_id)
    ensure_drive_mounted()

    for lang, cfg in manifest.get("channels", {}).items():
        artifact_file = cfg.get("artifact_file")
        mp4_path = work_dir / artifact_file
        if not mp4_path.exists():
            d_dir = drive_export_dir(drive_folder, project_id)
            if d_dir and (d_dir / artifact_file).exists():
                mp4_path = d_dir / artifact_file
        if not mp4_path.exists():
            print(f"[publish] Skipping {lang}: {artifact_file} not found.")
            continue

        token_path = Path(cfg["drive_token_path"])
        if not token_path.exists():
            print(f"[publish] Skipping {lang}: token file missing at {token_path}")
            continue

        print(
            f"[publish] Uploading {mp4_path.name} -> {cfg['channel_slot']} "
            f"(privacy={cfg.get('privacy_status', 'private')}, sha256={cfg.get('artifact_sha256')})",
            flush=True,
        )
        res = resumable_upload_mp4(
            mp4_path=mp4_path,
            expected_sha256=cfg.get("artifact_sha256", ""),
            channel_meta=cfg,
            token_path=token_path,
            drive_folder=drive_folder,
            project_id=project_id,
            language=lang,
        )
        print(f"[publish] {lang} result:", json.dumps(res), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Aether Studio v2.0 Colab Worker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pre = sub.add_parser("preflight")
    p_pre.add_argument("--base-url", default="")

    p_ren = sub.add_parser("render")
    p_ren.add_argument("--job", type=Path, default=None)
    p_ren.add_argument("--origin", default="")
    p_ren.add_argument("--pair-code", default="")

    p_pub = sub.add_parser("publish")
    p_pub.add_argument("--manifest", type=Path, required=True)
    p_pub.add_argument("--work-dir", type=Path, default=None)

    args = parser.parse_args()
    if args.cmd == "preflight":
        cmd_preflight(args.base_url or None)
    elif args.cmd == "render":
        cmd_render(args.job, args.origin or None, args.pair_code or None)
    elif args.cmd == "publish":
        cmd_publish(args.manifest, args.work_dir)


if __name__ == "__main__":
    main()
