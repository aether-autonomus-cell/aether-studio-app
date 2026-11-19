"""Optional T4 GPU 2D Anime Backdrop generator for Hybrid Mode (visual_mode == 'hybrid-2d').
Pure 2D procedural mode skips this module completely and runs on CPU.
"""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Any


def generate_hybrid_backdrops(
    job: dict[str, Any],
    work_dir: Path,
) -> dict[str, str]:
    project = job["project"]
    if project.get("visual_mode") != "hybrid-2d":
        return {}

    try:
        import torch
        from diffusers import StableDiffusionXLPipeline
    except ImportError:
        print("[hybrid-2d] diffusers/torch unavailable; falling back to pure 2D backdrops.")
        return {}

    if not torch.cuda.is_available():
        print("[hybrid-2d] No CUDA GPU detected; falling back to pure 2D backdrops.")
        return {}

    repo = os.environ.get("AETHER_IMAGE_REPO", "cagliostrolab/animagine-xl-3.1")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        repo,
        torch_dtype=torch.float16,
        use_safetensors=True,
    ).to("cuda")

    aspect = project.get("aspect_ratio", "9:16")
    width, height = (768, 1344) if aspect == "9:16" else (1344, 768)
    seed_base = int(project.get("seed", 42))

    backdrop_dir = work_dir / "hybrid_backdrops"
    backdrop_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, str] = {}

    for idx, scene in enumerate(project["scenes"]):
        sid = scene["id"]
        backdrop_cfg = scene.get("props", {}).get("backdrop", {})
        mood = backdrop_cfg.get("mood", "skyline")
        custom_prompt = backdrop_cfg.get("prompt") or (
            f"2D anime background art, {mood}, high contrast dark obsidian and cyan lighting, "
            "clean cel-shaded environment, no text, no characters"
        )
        gen = torch.Generator(device="cuda").manual_seed(seed_base + idx)
        image = pipe(
            prompt=custom_prompt,
            negative_prompt="text, watermark, blurry, 3d photorealistic, character",
            width=width,
            height=height,
            num_inference_steps=18,
            guidance_scale=6.5,
            generator=gen,
        ).images[0]

        out_path = backdrop_dir / f"{sid}.png"
        image.save(out_path)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        result[sid] = f"data:image/png;base64,{b64}"

    return result
