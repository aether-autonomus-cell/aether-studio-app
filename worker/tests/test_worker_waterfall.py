import pathlib
import tempfile
import unittest

from worker.colab_worker import run_scene_waterfall
from worker.contracts import ContractValidationError, validate_job_v1
from worker.timing import allocate_cumulative_frame_spans, frames_to_srt_timestamp, samples_to_frames_round


def make_sample_job(paid_routes: bool = False) -> dict:
    return {
        "schema_version": "kr.job.v1",
        "job_id": "job_test_1",
        "project_id": "proj_test_1",
        "story_revision_id": "srev_1",
        "settings_revision_id": "set_1",
        "idempotency_key": "idem_test_12345",
        "confirmed_by_user": True,
        "status": "queued",
        "fps": 24,
        "sample_rate": 48000,
        "zero_spend": {
            "paid_routes": paid_routes,
            "allow_billing_fallback": False,
            "allowed_free_routes": ["colab-free-gpu", "deterministic-local-director"],
            "pause_on_quota_exhaustion": True,
        },
        "scenes": [
            {
                "scene_id": "sc_01",
                "order_index": 0,
                "chapter_title": "Act I",
                "title": "Dusk",
                "location": "Stepwell",
                "mood": "calm",
                "camera_direction": "push",
                "visual_prompt": "Twilight sandstone stepwell",
                "hi_narration": "मीरा रुकती है।",
                "en_narration": "Meera pauses.",
                "target_duration_sec": 3,
            },
            {
                "scene_id": "sc_02",
                "order_index": 1,
                "chapter_title": "Act II",
                "title": "Glyph",
                "location": "Alcove",
                "mood": "wonder",
                "camera_direction": "pan",
                "visual_prompt": "Glowing stone glyph",
                "hi_narration": "रेखाएँ चमक उठती हैं।",
                "en_narration": "Lines begin to glow.",
                "target_duration_sec": 3,
            },
        ],
        "checkpoints": [],
        "settings": {
            "image_baseline": {
                "model_id": "black-forest-labs/FLUX.2-klein-4B",
                "model_revision": "e7b7dc27f91deacad38e78976d1f2b499d76a294",
                "width": 1344,
                "height": 768,
                "steps": 4,
                "guidance_scale": 1.0,
                "grade_profile": "restrained-v1",
                "text_encoder": "Qwen3ForCausalLM-NF4-FP32",
            },
            "voices": {
                "hi": {"language": "hi", "provider": "edge_tts_free", "voice_id": "hi-IN-SwaraNeural", "speaking_rate": 1.0},
                "en": {"language": "en", "provider": "edge_tts_free", "voice_id": "en-IN-NeerjaNeural", "speaking_rate": 1.0},
            },
        },
    }


class WorkerConformanceTests(unittest.TestCase):
    def test_timing_parity_with_typescript(self) -> None:
        self.assertEqual(samples_to_frames_round(48_000), 24)
        self.assertEqual(samples_to_frames_round(24_000), 12)
        self.assertEqual(frames_to_srt_timestamp(24), "00:00:01,000")
        spans = allocate_cumulative_frame_spans([192_000, 193_000, 191_000], 24)
        self.assertEqual(spans[0].in_frame, 0)
        self.assertEqual(spans[2].out_frame, 288)

    def test_zero_spend_blocks_paid_routes(self) -> None:
        bad = make_sample_job(paid_routes=True)
        with self.assertRaises(ContractValidationError):
            validate_job_v1(bad)

    def test_rejected_kokoro_voices_blocked(self) -> None:
        job = make_sample_job()
        job["settings"]["voices"]["hi"]["voice_id"] = "hm_omega"
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ContractValidationError):
                run_scene_waterfall(job, pathlib.Path(tmp), mode="dry-run-fixture")

    def test_sequential_waterfall_completes_and_failure_blocks_next_scene(self) -> None:
        job = make_sample_job()
        with tempfile.TemporaryDirectory() as tmp:
            events = []
            out_ok = run_scene_waterfall(
                job,
                pathlib.Path(tmp) / "ok",
                mode="dry-run-fixture",
                emit_checkpoint=lambda ev: events.append(ev),
            )
            self.assertEqual(out_ok["status"], "completed")
            self.assertEqual(len(out_ok["completed_scenes"]), 2)
            self.assertGreaterEqual(len(events), 16)

            fail_events = []
            out_fail = run_scene_waterfall(
                job,
                pathlib.Path(tmp) / "fail",
                mode="dry-run-fixture",
                emit_checkpoint=lambda ev: fail_events.append(ev),
                simulate_fail_scene_id="sc_01",
            )
            self.assertEqual(out_fail["status"], "failed")
            self.assertEqual(out_fail["halted_at_scene"], "sc_01")
            self.assertEqual(len(out_fail["completed_scenes"]), 0)
            self.assertFalse(any(e["scene_id"] == "sc_02" for e in fail_events))


if __name__ == "__main__":
    unittest.main()
