"""KathaRift Studio — Canonical kr.job.v1 & kr.timeline.v1 Validation (Python Worker)."""
from __future__ import annotations

from typing import Any, Dict, List

from worker.timing import KR_FPS, KR_SAMPLE_RATE

KR_SCENE_STAGES = (
    "queued",
    "image",
    "speech_hi",
    "speech_en",
    "timing",
    "compose",
    "verify",
    "drive_save",
    "ready",
    "timeline_append",
    "failed",
)

FREE_ROUTE_ALLOWLIST = (
    "colab-free-gpu",
    "local-studio-preview",
    "google-gemini-free-tier",
    "groq-free-tier",
    "openrouter-free-tier",
    "deterministic-local-director",
)

FLUX2_KLEIN_BASELINE = {
    "model_id": "black-forest-labs/FLUX.2-klein-4B",
    "model_revision": "e7b7dc27f91deacad38e78976d1f2b499d76a294",
    "width": 1344,
    "height": 768,
    "steps": 4,
    "guidance_scale": 1.0,
    "grade_profile": "restrained-v1",
    "text_encoder": "Qwen3ForCausalLM-NF4-FP32",
}


class ContractValidationError(ValueError):
    """Raised when a job or timeline payload violates kr.job.v1 / kr.timeline.v1."""


def validate_zero_spend(policy: Dict[str, Any]) -> None:
    if not isinstance(policy, dict):
        raise ContractValidationError("zero_spend must be an object")
    if policy.get("paid_routes") is not False:
        raise ContractValidationError("Strict zero-spend violation: paid_routes must be false")
    if policy.get("allow_billing_fallback") is not False:
        raise ContractValidationError("Strict zero-spend violation: allow_billing_fallback must be false")
    routes = policy.get("allowed_free_routes")
    if not isinstance(routes, list) or not routes:
        raise ContractValidationError("allowed_free_routes must be a non-empty list")
    for r in routes:
        if r not in FREE_ROUTE_ALLOWLIST:
            raise ContractValidationError(f"Route '{r}' is not on the free-route allowlist")


def validate_job_v1(job: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(job, dict):
        raise ContractValidationError("Job must be a JSON object")
    if job.get("schema_version") != "kr.job.v1":
        raise ContractValidationError(f"Expected schema_version kr.job.v1, got {job.get('schema_version')}")
    if job.get("confirmed_by_user") is not True:
        raise ContractValidationError("Job cannot run without explicit confirmed_by_user=true")
    if job.get("fps") != KR_FPS:
        raise ContractValidationError(f"Expected fps={KR_FPS}, got {job.get('fps')}")
    if job.get("sample_rate") != KR_SAMPLE_RATE:
        raise ContractValidationError(f"Expected sample_rate={KR_SAMPLE_RATE}, got {job.get('sample_rate')}")
    validate_zero_spend(job.get("zero_spend", {}))

    scenes: List[Dict[str, Any]] = job.get("scenes") or []
    if not scenes:
        raise ContractValidationError("kr.job.v1 requires at least 1 scene")
    for idx, sc in enumerate(scenes):
        for field in ("scene_id", "visual_prompt", "hi_narration", "en_narration"):
            if not sc.get(field):
                raise ContractValidationError(f"Scene[{idx}] missing required field '{field}'")

    settings = job.get("settings") or {}
    img_cfg = settings.get("image_baseline") or {}
    if img_cfg.get("width") != 1344 or img_cfg.get("height") != 768:
        raise ContractValidationError("Image baseline locked to 1344x768")
    if img_cfg.get("model_id") != FLUX2_KLEIN_BASELINE["model_id"]:
        raise ContractValidationError(f"Unexpected image model_id: {img_cfg.get('model_id')}")
    if img_cfg.get("model_revision") != FLUX2_KLEIN_BASELINE["model_revision"]:
        raise ContractValidationError(f"Unexpected image model_revision: {img_cfg.get('model_revision')}")
    return job


def validate_timeline_v1(timeline: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(timeline, dict):
        raise ContractValidationError("Timeline must be a JSON object")
    if timeline.get("schema_version") != "kr.timeline.v1":
        raise ContractValidationError(f"Expected schema_version kr.timeline.v1, got {timeline.get('schema_version')}")
    if timeline.get("fps") != KR_FPS or timeline.get("sample_rate") != KR_SAMPLE_RATE:
        raise ContractValidationError("Timeline fps/sample_rate mismatch")
    clips = timeline.get("clips") or []
    prev_out = 0
    for clip in clips:
        in_f = clip.get("in_frame")
        out_f = clip.get("out_frame")
        if not isinstance(in_f, int) or not isinstance(out_f, int) or out_f <= in_f or in_f < 0:
            raise ContractValidationError(f"Invalid clip half-open span: {(in_f, out_f)}")
        if in_f < prev_out:
            raise ContractValidationError(f"Overlapping clip at frame {in_f} < {prev_out}")
        prev_out = out_f
    return timeline
