"""Resumable dual-channel YouTube Data API v3 upload client with Drive checkpointing
and SHA-256 artifact verification.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from worker.drive import load_upload_checkpoints, save_upload_checkpoints
from worker.mux import sha256_file

YOUTUBE_UPLOAD_INIT_URL = (
    "https://www.googleapis.com/upload/youtube/v3/videos"
    "?uploadType=resumable&part=snippet,status"
)
CHUNK_SIZE = 8 * 1024 * 1024  # 8 MiB aligned chunk


def _refresh_access_token(token_cfg: dict[str, Any]) -> str:
    if token_cfg.get("access_token") and not token_cfg.get("refresh_token"):
        return str(token_cfg["access_token"])
    client_id = token_cfg.get("client_id", "")
    client_secret = token_cfg.get("client_secret", "")
    refresh_token = token_cfg.get("refresh_token", "")
    if not (client_id and client_secret and refresh_token):
        if token_cfg.get("access_token"):
            return str(token_cfg["access_token"])
        raise RuntimeError("Token JSON missing refresh_token/client_id/client_secret")

    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return str(payload["access_token"])


def _init_resumable_session(
    access_token: str,
    file_size: int,
    meta: dict[str, Any],
) -> str:
    body = json.dumps(
        {
            "snippet": {
                "title": meta["title"][:100],
                "description": meta.get("description", ""),
                "tags": meta.get("tags", []),
                "categoryId": "22",
            },
            "status": {
                "privacyStatus": meta.get("privacy_status", "private"),
                "selfDeclaredMadeForKids": bool(meta.get("made_for_kids", False)),
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        YOUTUBE_UPLOAD_INIT_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(file_size),
            "X-Upload-Content-Type": "video/mp4",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        session_uri = resp.headers.get("Location")
    if not session_uri:
        raise RuntimeError("YouTube resumable init did not return Location header")
    return session_uri


def resumable_upload_mp4(
    mp4_path: Path,
    expected_sha256: str,
    channel_meta: dict[str, Any],
    token_path: Path,
    drive_folder: str,
    project_id: str,
    language: str,
) -> dict[str, Any]:
    if not mp4_path.exists():
        raise FileNotFoundError(f"MP4 artifact missing: {mp4_path}")

    actual_sha = sha256_file(mp4_path)
    if expected_sha256 and expected_sha256 != "VERIFY_IN_RENDER_REPORT" and actual_sha != expected_sha256:
        raise RuntimeError(
            f"SHA-256 mismatch for {mp4_path.name}: expected {expected_sha256}, got {actual_sha}"
        )

    token_cfg = json.loads(token_path.read_text(encoding="utf-8"))
    access_token = _refresh_access_token(token_cfg)
    file_size = mp4_path.stat().st_size

    checkpoints = load_upload_checkpoints(drive_folder, project_id)
    ckpt = checkpoints.get(language, {})
    session_uri = ckpt.get("session_uri") if ckpt.get("sha256") == actual_sha else None
    offset = int(ckpt.get("offset", 0)) if session_uri else 0

    if not session_uri:
        session_uri = _init_resumable_session(access_token, file_size, channel_meta)
        offset = 0
        checkpoints[language] = {"session_uri": session_uri, "offset": 0, "sha256": actual_sha}
        save_upload_checkpoints(drive_folder, project_id, checkpoints)

    with mp4_path.open("rb") as fh:
        fh.seek(offset)
        while offset < file_size:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            end = offset + len(chunk) - 1
            req = urllib.request.Request(
                session_uri,
                data=chunk,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {offset}-{end}/{file_size}",
                    "Content-Type": "video/mp4",
                },
                method="PUT",
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                    offset = file_size
                    checkpoints[language] = {
                        "session_uri": session_uri,
                        "offset": offset,
                        "sha256": actual_sha,
                        "video_id": result.get("id"),
                    }
                    save_upload_checkpoints(drive_folder, project_id, checkpoints)
                    return result
            except urllib.error.HTTPError as err:
                if err.code == 308:
                    offset = end + 1
                    checkpoints[language]["offset"] = offset
                    save_upload_checkpoints(drive_folder, project_id, checkpoints)
                else:
                    raise
    return {"status": "completed"}
