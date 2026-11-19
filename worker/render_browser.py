"""Isolated Playwright Chromium 2D frame renderer.
Process Isolation Security Boundary:
- Runs in a clean subprocess with sensitive env vars stripped.
- Intercepts and blocks all external outbound network requests.
- Serves local public/renderer/* over an ephemeral 127.0.0.1 HTTP server.
- Pipes lossless PNG frames directly into FFmpeg via argument arrays.
- Supports segmented H.264 chunk rendering (>90s) with checkpointing.
"""

from __future__ import annotations

import functools
import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def _start_local_renderer_server(public_dir: Path) -> tuple[socketserver.TCPServer, int]:
    handler = functools.partial(_QuietHandler, directory=str(public_dir))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = int(httpd.server_address[1])
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port


def _render_segment(
    page: Any,
    start_frame: int,
    end_frame: int,
    fps: int,
    segment_mp4: Path,
) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-framerate",
        str(fps),
        "-i",
        "pipe:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        str(segment_mp4),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    try:
        for frame_idx in range(start_frame, end_frame):
            page.evaluate(f"window.Aether.renderAt({frame_idx})")
            png_bytes = page.locator("#stage").screenshot(type="png")
            proc.stdin.write(png_bytes)
        proc.stdin.close()
    except Exception:
        proc.kill()
        raise
    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"FFmpeg video segment failed with exit code {ret}")


def render_video_track(
    bundle_path: Path,
    public_dir: Path,
    output_video_mp4: Path,
    checkpoint_dir: Path | None = None,
) -> None:
    from playwright.sync_api import sync_playwright

    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    width = int(bundle["width"])
    height = int(bundle["height"])
    fps = int(bundle["fps"])
    total_frames = int(bundle["totalFrames"])

    httpd, port = _start_local_renderer_server(public_dir)
    base_origin = f"http://127.0.0.1:{port}"
    segment_frames = fps * 45  # 45s deterministic segments for long renders up to 600s

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()

            def _route_guard(route: Any) -> None:
                url = route.request.url
                if url.startswith(base_origin) or url.startswith("data:") or url.startswith("blob:"):
                    route.continue_()
                else:
                    route.abort("blockedbyclient")

            page.route("**/*", _route_guard)
            page.goto(f"{base_origin}/renderer/index.html", wait_until="load")
            page.evaluate("(b) => window.Aether.init(b)", bundle)

            if total_frames <= fps * 90:
                _render_segment(page, 0, total_frames, fps, output_video_mp4)
            else:
                seg_dir = output_video_mp4.parent / f"segments_{output_video_mp4.stem}"
                seg_dir.mkdir(parents=True, exist_ok=True)
                seg_paths: list[Path] = []
                seg_idx = 0
                for start_f in range(0, total_frames, segment_frames):
                    end_f = min(total_frames, start_f + segment_frames)
                    seg_file = seg_dir / f"seg_{seg_idx:03d}.mp4"
                    ckpt_file = (
                        checkpoint_dir / f"{output_video_mp4.stem}_seg_{seg_idx:03d}.mp4"
                        if checkpoint_dir
                        else None
                    )
                    if ckpt_file and ckpt_file.exists():
                        shutil.copy2(ckpt_file, seg_file)
                    elif not seg_file.exists():
                        _render_segment(page, start_f, end_f, fps, seg_file)
                        if ckpt_file:
                            ckpt_file.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(seg_file, ckpt_file)
                    seg_paths.append(seg_file)
                    seg_idx += 1

                concat_list = seg_dir / "concat.txt"
                concat_list.write_text(
                    "\n".join(f"file '{p.as_posix()}'" for p in seg_paths),
                    encoding="utf-8",
                )
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-loglevel",
                        "error",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(concat_list),
                        "-c",
                        "copy",
                        "-movflags",
                        "+faststart",
                        str(output_video_mp4),
                    ],
                    check=True,
                )

            context.close()
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    # Isolated subprocess CLI entrypoint
    if len(sys.argv) < 4:
        raise SystemExit("usage: render_browser.py <bundle.json> <public_dir> <out.mp4> [ckpt_dir]")
    ckpt = Path(sys.argv[4]) if len(sys.argv) >= 5 else None
    render_video_track(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), ckpt)
