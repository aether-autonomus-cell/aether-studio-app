"""Google Drive mount, direct artifact export, and upload checkpoint storage."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

DRIVE_MOUNT_POINT = Path("/content/drive")
DRIVE_MYDRIVE = DRIVE_MOUNT_POINT / "MyDrive"


def ensure_drive_mounted() -> bool:
    if DRIVE_MYDRIVE.exists():
        return True
    try:
        from google.colab import drive  # type: ignore

        drive.mount(str(DRIVE_MOUNT_POINT), force_remount=False)
        return DRIVE_MYDRIVE.exists()
    except Exception:
        return False


def drive_export_dir(folder_name: str, project_id: str) -> Path | None:
    if not DRIVE_MYDRIVE.exists():
        return None
    target = DRIVE_MYDRIVE / folder_name / project_id
    target.mkdir(parents=True, exist_ok=True)
    return target


def save_artifacts_to_drive(
    source_files: list[Path],
    folder_name: str,
    project_id: str,
) -> list[str]:
    target_dir = drive_export_dir(folder_name, project_id)
    if target_dir is None:
        return []
    saved: list[str] = []
    for src in source_files:
        if src.exists():
            dst = target_dir / src.name
            shutil.copy2(src, dst)
            saved.append(str(dst))
    return saved


def load_upload_checkpoints(folder_name: str, project_id: str) -> dict[str, Any]:
    target_dir = drive_export_dir(folder_name, project_id)
    if target_dir is None:
        return {}
    ckpt_path = target_dir / "upload_checkpoints.json"
    if not ckpt_path.exists():
        return {}
    try:
        return json.loads(ckpt_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_upload_checkpoints(
    folder_name: str,
    project_id: str,
    data: dict[str, Any],
) -> None:
    target_dir = drive_export_dir(folder_name, project_id)
    if target_dir is None:
        return
    ckpt_path = target_dir / "upload_checkpoints.json"
    ckpt_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
