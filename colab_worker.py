# Aether Manhua Explanation Factory
# Colab T4 (15GB) or Kaggle T4x2 (30GB). Paste the whole cell and run.
# Printed Worker URL goes into the phone Settings. Nothing here is saved back to the phone.

import os, sys, json, uuid, time, shutil, threading, subprocess, base64, re
from pathlib import Path

PORT = 8787
ROOT = Path("/kaggle/working" if Path("/kaggle/working").exists() else "/content")
ROOT.mkdir(parents=True, exist_ok=True)
MODELS = ROOT / "models"
MODELS.mkdir(exist_ok=True)
OUT = ROOT / "aether_out"
OUT.mkdir(exist_ok=True)
TOKEN = os.environ.get("AETHER_TOKEN", "")
JOBS = {}
LATEST = {"preview": None, "mp4": None}
PANEL_CACHE = {}
PANEL_DIR = OUT / "panels"
VOICE_DIR = OUT / "voices"
CLIP_DIR = OUT / "clips"
for _folder in (PANEL_DIR, VOICE_DIR, CLIP_DIR):
    _folder.mkdir(exist_ok=True)
TIMING_PATH = OUT / "timing.json"
PAINTER = {"pipe": None, "img2img": None, "kind": "", "name": ""}
VISION = {"model": None}
OCR = {"reader": None}
FETCH_JOBS = {}
LLM = {"obj": None, "mode": "", "name": ""}

def pip_try(args):
    subprocess.call([sys.executable, "-m", "pip", "install", "-q", *args])

pip_try(["fastapi", "uvicorn", "edge-tts", "pillow", "requests", "huggingface_hub"])
try:
    import torch
    GPU_COUNT = torch.cuda.device_count() if torch.cuda.is_available() else 0
    GPU_NAMES = [torch.cuda.get_device_name(i) for i in range(GPU_COUNT)]
except Exception:
    torch = None
    GPU_COUNT = 0
    GPU_NAMES = []
print("GPUs", GPU_COUNT, GPU_NAMES, flush=True)
print("Image checkpoint", os.environ.get("AETHER_IMAGE_REPO", "cagliostrolab/animagine-xl-3.1"), flush=True)
print("Set AETHER_IMAGE_REPO to a Flux repo or a manhwa checkpoint before this cell if you do not want Animagine XL. Pollinations is only the fallback when that model cannot load.", flush=True)
print("Full GLM-5.2 4-bit GGUF is about 466GB and will not fit Colab T4 or Kaggle T4x2. gguf mode loads a 4-bit distill (default GLM-4-9B Q4) unless AETHER_GGUF_REPO is set. Flagship GLM-5.2 stays on the cloud key (Z.ai / OpenRouter / GitHub Models).", flush=True)
if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
    subprocess.call(["apt-get", "update", "-qq"])
    subprocess.call(["apt-get", "install", "-y", "-qq", "ffmpeg"])

def sh(args, **kw):
    subprocess.check_call(args, **kw)

def allowed(headers, token=""):
    if not TOKEN:
        return True
    presented = headers.get("x-aether-token", "") or token
    return presented == TOKEN

def han(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)

def load_llm(mode):
    if LLM["obj"] is not None and LLM["mode"] == mode:
        return LLM
    if mode == "gguf":
        # CUDA wheel first so Kaggle T4x2 / Colab T4 actually offload layers. CPU wheel is the fallback.
        cuda = subprocess.call([sys.executable, "-m", "pip", "install", "-q", "llama-cpp-python", "--extra-index-url", "https://abetlen.github.io/llama-cpp-python/whl/cu124"])
        if cuda != 0:
            os.environ["CMAKE_ARGS"] = "-DGGML_CUDA=on"
            os.environ["FORCE_CMAKE"] = "1"
            pip_try(["llama-cpp-python"])
        from llama_cpp import Llama
        gguf = next(MODELS.glob("*.gguf"), None)
        if gguf is None:
            from huggingface_hub import hf_hub_download
            repo = os.environ.get("AETHER_GGUF_REPO", "bartowski/glm-4-9b-chat-GGUF")
            name = os.environ.get("AETHER_GGUF_FILE", "glm-4-9b-chat-Q4_K_M.gguf")
            path = hf_hub_download(repo_id=repo, filename=name, local_dir=str(MODELS))
            gguf = Path(path)
        kwargs = {"model_path": str(gguf), "n_gpu_layers": -1, "n_ctx": 4096, "verbose": False}
        if GPU_COUNT >= 2:
            kwargs["tensor_split"] = [1.0 / GPU_COUNT] * GPU_COUNT
        llm = Llama(**kwargs)
        LLM.update(obj=llm, mode=mode, name=gguf.name)
        return LLM
    if mode == "airllm":
        pip_try(["airllm"])
        from airllm import AutoModel
        repo = os.environ.get("AETHER_AIR_REPO", "Qwen/Qwen2.5-14B-Instruct")
        model = AutoModel.from_pretrained(repo)
        LLM.update(obj=model, mode=mode, name=repo)
        return LLM
    pip_try(["transformers", "accelerate", "bitsandbytes"])
    from transformers import AutoModelForCausalLM, AutoTokenizer
    repo = os.environ.get("AETHER_FAST_REPO", "Qwen/Qwen2.5-14B-Instruct")
    tok = AutoTokenizer.from_pretrained(repo)
    model = AutoModelForCausalLM.from_pretrained(repo, device_map="auto", torch_dtype="auto")
    LLM.update(obj=(tok, model), mode="fast", name=repo)
    return LLM

def complete(mode, system, prompt):
    bundle = load_llm(mode if mode in ("gguf", "airllm", "fast") else "fast")
    user = system + "\n\n" + prompt
    if bundle["mode"] == "gguf":
        out = bundle["obj"].create_chat_completion(messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}], max_tokens=4096, temperature=0.4)
        return out["choices"][0]["message"]["content"]
    if bundle["mode"] == "airllm":
        model = bundle["obj"]
        tokens = model.tokenizer([user], return_tensors="pt")
        ids = tokens["input_ids"]
        if torch is not None and GPU_COUNT:
            ids = ids.cuda()
        gen = model.generate(ids, max_new_tokens=1200)
        return model.tokenizer.decode(gen[0], skip_special_tokens=True)
    tok, model = bundle["obj"]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    batch = tok(text, return_tensors="pt").to(model.device)
    gen = model.generate(**batch, max_new_tokens=1200, do_sample=False)
    return tok.decode(gen[0][batch["input_ids"].shape[1]:], skip_special_tokens=True)

def ink_panel(prompt, dest, size):
    from PIL import Image, ImageDraw
    seed = abs(hash(prompt or "panel")) % 9973
    w, h = size
    im = Image.new("RGB", (w, h), (16, 12, 14))
    draw = ImageDraw.Draw(im, "RGBA")
    for band in range(16):
        y0 = int(h * band / 16)
        y1 = int(h * (band + 1) / 16) + 1
        shade = 20 + band * 6 + (seed % 18)
        draw.rectangle([0, y0, w, y1], fill=(shade, 16 + band * 2, 22 + (seed % 10), 255))
    moon = 64 + (seed % 48)
    mx = int(w * (0.58 + (seed % 17) / 100))
    my = int(h * 0.08)
    draw.ellipse([mx, my, mx + moon * 2, my + moon * 2], fill=(236, 220, 186, 235))
    ridge = int(h * (0.58 + (seed % 8) / 100))
    draw.polygon([(0, ridge + 80), (int(w * 0.35), ridge), (int(w * 0.62), ridge + 46), (w, ridge - 10), (w, h), (0, h)], fill=(12, 10, 14, 255))
    cx = int(w * (0.28 + (seed % 40) / 100))
    cy = int(h * 0.62)
    robe = (120 + (seed % 90), 36, 28, 255)
    draw.polygon([(cx - 46, cy + 220), (cx, cy + 36), (cx + 46, cy + 220)], fill=robe)
    draw.ellipse([cx - 22, cy - 10, cx + 22, cy + 36], fill=(232, 214, 190, 255))
    if seed % 2 == 0:
        draw.line([(cx + 30, cy + 20), (cx + 150, cy - 80)], fill=(210, 210, 220, 255), width=6)
    im.convert("RGB").save(dest)
    return dest

def fetch_image(raw, dest):
    if isinstance(raw, str) and raw.startswith("data:"):
        b64 = raw.split(",", 1)[-1]
        dest.write_bytes(base64.b64decode(b64))
        return True
    if isinstance(raw, str) and raw.startswith("http"):
        import requests
        res = requests.get(raw, timeout=40)
        res.raise_for_status()
        if len(res.content) < 64:
            return False
        dest.write_bytes(res.content)
        return True
    return False

def safe_id(value):
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", str(value or "panel"))[:80]
    return cleaned or "panel"

def load_timing():
    if TIMING_PATH.exists():
        try:
            data = json.loads(TIMING_PATH.read_text())
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}

def save_timing(data):
    TIMING_PATH.write_text(json.dumps(data))

def load_painter():
    if PAINTER["pipe"] is not None:
        return PAINTER
    if GPU_COUNT < 1 or torch is None:
        raise RuntimeError("no GPU for the manhwa checkpoint")
    pip_try(["diffusers", "transformers", "accelerate", "safetensors", "sentencepiece", "protobuf"])
    repo = os.environ.get("AETHER_IMAGE_REPO", "cagliostrolab/animagine-xl-3.1")
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if "flux" in repo.lower():
        from diffusers import FluxPipeline
        pipe = FluxPipeline.from_pretrained(repo, torch_dtype=torch.bfloat16, token=token)
        pipe.enable_model_cpu_offload()
        img2img = None
        try:
            from diffusers import FluxImg2ImgPipeline
            img2img = FluxImg2ImgPipeline(**pipe.components)
        except Exception as exc:
            print("flux img2img unavailable", exc, flush=True)
        PAINTER.update(pipe=pipe, img2img=img2img, kind="flux", name=repo)
        return PAINTER
    from diffusers import StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline
    try:
        pipe = StableDiffusionXLPipeline.from_pretrained(repo, torch_dtype=torch.float16, variant="fp16", use_safetensors=True, token=token)
    except Exception:
        pipe = StableDiffusionXLPipeline.from_pretrained(repo, torch_dtype=torch.float16, use_safetensors=True, token=token)
    pipe.enable_model_cpu_offload()
    img2img = StableDiffusionXLImg2ImgPipeline(**pipe.components)
    PAINTER.update(pipe=pipe, img2img=img2img, kind="sdxl", name=repo)
    return PAINTER

def paint_local(prompt, dest, size, reference):
    from PIL import Image
    bundle = load_painter()
    w = max(512, (min(size[0], 832) // 64) * 64)
    h = max(768, (min(size[1], 1216) // 64) * 64)
    if bundle["kind"] == "flux":
        if reference and bundle.get("img2img") is not None:
            ref = Image.open(reference).convert("RGB").resize((w, h))
            image = bundle["img2img"](prompt=prompt, image=ref, strength=0.4, guidance_scale=3.5, num_inference_steps=4, height=h, width=w, max_sequence_length=256).images[0]
        else:
            image = bundle["pipe"](prompt, height=h, width=w, guidance_scale=3.5, num_inference_steps=4, max_sequence_length=256).images[0]
    elif reference and bundle.get("img2img") is not None:
        ref = Image.open(reference).convert("RGB").resize((w, h))
        image = bundle["img2img"](prompt=prompt, image=ref, strength=0.42, num_inference_steps=28, guidance_scale=6.5, height=h, width=w).images[0]
    else:
        image = bundle["pipe"](prompt=prompt, num_inference_steps=28, guidance_scale=6.5, height=h, width=w).images[0]
    image.convert("RGB").save(dest)
    return bundle["kind"] + ("+ref" if reference else "")

def paint_prompt(prompt, dest, size, reference=None):
    import requests, urllib.parse
    locked = "Vertical colored manhwa, clean ink, dramatic lighting, consistent character, no text, no letters, no watermark, no speech bubbles. " + (prompt or "panel")
    try:
        kind = paint_local(locked, dest, size, reference)
        print("checkpoint panel", kind, flush=True)
        return kind
    except Exception as exc:
        print("checkpoint skipped", exc, flush=True)
    try:
        url = "https://image.pollinations.ai/prompt/" + urllib.parse.quote(locked[:480]) + "?width=%d&height=%d&nologo=true&model=flux" % (min(size[0], 768), min(size[1], 1152))
        res = requests.get(url, timeout=90)
        kind = res.headers.get("content-type", "")
        if res.ok and kind.startswith("image") and len(res.content) > 1000:
            dest.write_bytes(res.content)
            print("pollinations panel — faces can drift", flush=True)
            return "pollinations"
    except Exception as exc:
        print("pollinations skipped", exc, flush=True)
    ink_panel(prompt, dest, size)
    return "ink"

def materialize_reference(payload):
    dest = OUT / "ref-face.png"
    raw_b64 = payload.get("referenceBase64") or ""
    raw = payload.get("reference") or ""
    try:
        if isinstance(raw_b64, str) and len(raw_b64) > 80:
            dest.write_bytes(base64.b64decode(raw_b64))
            return dest
        if isinstance(raw, str) and (raw.startswith("http") or raw.startswith("data:")) and fetch_image(raw, dest):
            return dest
    except Exception as exc:
        print("reference skipped", exc, flush=True)
    return None

def ensure_panel(scene, dest, size, revoice):
    sid = safe_id(scene.get("id") or dest.stem)
    stable = PANEL_DIR / f"{sid}.png"
    raw = scene.get("image_url") or ""
    if stable.exists() and stable.stat().st_size > 64:
        shutil.copy(stable, dest)
        PANEL_CACHE[sid] = str(stable)
        return "kept"
    if isinstance(raw, str) and (raw.startswith("http") or raw.startswith("data:")):
        try:
            if fetch_image(raw, stable):
                shutil.copy(stable, dest)
                PANEL_CACHE[sid] = str(stable)
                return "fetched"
        except Exception as exc:
            print("panel fetch failed", exc, flush=True)
    cached = PANEL_CACHE.get(sid)
    if cached and Path(cached).exists():
        shutil.copy(cached, stable)
        shutil.copy(stable, dest)
        return "cache"
    if revoice:
        raise RuntimeError("Picture missing for %s. Re-voice will not draw a new one." % sid)
    tiles = scene.get("tiles") or [{}]
    prompt = tiles[0].get("prompt") if tiles and isinstance(tiles[0], dict) else ""
    reference = materialize_reference({"reference": scene.get("reference") or ""})
    paint_prompt(raw if isinstance(raw, str) else "" or prompt or "", stable, size, reference)
    shutil.copy(stable, dest)
    PANEL_CACHE[sid] = str(stable)
    return "painted"

def voice_file_name(sid, lang, voice):
    slug = re.sub(r"[^A-Za-z0-9]", "", str(voice or ""))[:32] or "male"
    return f"{safe_id(sid)}_{lang}_{slug}.mp3"

def speak_to(text, voice, dest):
    import edge_tts, asyncio
    last = "edge refused"
    for attempt in range(3):
        try:
            asyncio.run(edge_tts.Communicate((text or " ")[:700], voice).save(str(dest)))
            if dest.exists() and dest.stat().st_size > 200:
                return "edge"
        except Exception as exc:
            last = str(exc)
            print("edge retry", attempt, exc, flush=True)
            time.sleep(1.2)
    espeak = shutil.which("espeak-ng") or shutil.which("espeak")
    if not espeak:
        subprocess.call(["apt-get", "install", "-y", "-qq", "espeak-ng"])
        espeak = shutil.which("espeak-ng") or shutil.which("espeak")
    if not espeak:
        raise RuntimeError("Edge TTS refused and no local voice was available. " + last[:180])
    wav = dest.with_suffix(".wav")
    code = "hi" if str(voice).startswith("hi-") else "en"
    sh([espeak, "-v", code, "-w", str(wav), (text or " ")[:500]])
    sh(["ffmpeg", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-q:a", "4", str(dest)])
    print("local voice fallback", code, flush=True)
    return "espeak"

def panel_clip(sid, img, hold, size, sfx, revoice=False):
    W, H = size
    meta_path = CLIP_DIR / f"{sid}.json"
    dest = CLIP_DIR / f"{sid}.mp4"
    prev = None
    if meta_path.exists():
        try:
            prev = json.loads(meta_path.read_text())
        except Exception:
            prev = None
    old = float(prev.get("hold") or 0) if isinstance(prev, dict) else 0
    if prev and dest.exists() and hold <= old + 0.08:
        return dest
    if revoice and prev and dest.exists() and hold > old:
        extra = max(hold - old, 0.04)
        extended = CLIP_DIR / f"{sid}-hold.mp4"
        sh(["ffmpeg", "-y", "-i", str(dest), "-vf", f"tpad=stop_mode=clone:stop_duration={extra:.3f}", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(extended)])
        shutil.move(str(extended), str(dest))
        meta_path.write_text(json.dumps({"hold": round(hold, 3)}))
        print("extended hold only", sid, flush=True)
        return dest
    frames = max(int(hold * 30), 36)
    shake = "shake" in (sfx or "").lower() or sfx in ("CRACK", "BOOM", "SHING")
    vf = f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},zoompan=z='min(1.0+0.0012*on,1.22)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+on*0.45':d={frames}:s={W}x{H}:fps=30"
    if shake:
        vf += f",crop=iw-24:ih-24:12+8*sin(n*2):12+6*cos(n*3),scale={W}:{H}"
    vf += ",fade=t=in:st=0:d=0.18,format=yuv420p"
    sh(["ffmpeg", "-y", "-loop", "1", "-i", str(img), "-vf", vf, "-t", str(round(hold, 3)), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dest)])
    meta_path.write_text(json.dumps({"hold": round(hold, 3)}))
    return dest

def vision_check(prompt, image_path):
    from PIL import Image
    image = Image.open(image_path).convert("RGB")
    try:
        if VISION["model"] is None:
            pip_try(["transformers", "accelerate", "einops", "pyvips"])
            repo = os.environ.get("AETHER_VISION_REPO", "vikhyatk/moondream2")
            from transformers import AutoModelForCausalLM
            dtype = torch.float16 if GPU_COUNT and torch is not None else None
            model = AutoModelForCausalLM.from_pretrained(repo, trust_remote_code=True, torch_dtype=dtype)
            if GPU_COUNT and torch is not None:
                model = model.to("cuda")
            VISION["model"] = model
        model = VISION["model"]
        question = "Look at the face, hair, outfit, and scene. Does this image match the description? First word yes or no, then one sentence. Description: " + (prompt or "")[:700]
        if hasattr(model, "query"):
            answer = model.query(image, question)
            text = answer.get("answer") if isinstance(answer, dict) else str(answer)
        else:
            encoded = model.encode_image(image)
            tok = getattr(model, "tokenizer", None)
            text = str(model.answer_question(encoded, question, tok))
        cleaned = text.strip()
        match = cleaned.lower().startswith("yes")
        return {"match": bool(match), "note": cleaned[:240]}
    except Exception as exc:
        print("vision model skipped", exc, flush=True)
    try:
        pip_try(["transformers"])
        from transformers import CLIPModel, CLIPProcessor
        clip_id = "openai/clip-vit-base-patch32"
        if VISION.get("clip") is None:
            VISION["clip"] = (
                CLIPModel.from_pretrained(clip_id),
                CLIPProcessor.from_pretrained(clip_id),
            )
        model, processor = VISION["clip"]
        inputs = processor(text=[(prompt or "manhwa panel")[:300], "an empty wall"], images=image, return_tensors="pt", padding=True)
        score = float(model(**inputs).logits_per_image.softmax(dim=1)[0, 0])
        return {"match": score >= 0.24, "note": "CLIP score %.2f. The face model did not load, so this is a weak check." % score}
    except Exception as exc:
        return {"match": "skipped", "note": ("Vision did not load. " + str(exc))[:240]}

def read_bubbles(path):
    try:
        if OCR["reader"] is None:
            pip_try(["easyocr"])
            import easyocr
            OCR["reader"] = easyocr.Reader(["ch_sim", "en"], gpu=GPU_COUNT > 0)
        rows = OCR["reader"].readtext(str(path))
    except Exception as exc:
        print("ocr skipped", exc, flush=True)
        return "", ""
    from PIL import Image
    height = Image.open(path).size[1] or 1
    bubbles = []
    asides = []
    for box, text, conf in rows:
        if conf < 0.35 or not str(text).strip():
            continue
        ys = [point[1] for point in box]
        cy = sum(ys) / max(len(ys), 1) / height
        line = str(text).strip()
        if cy < 0.72 and len(line) <= 80:
            bubbles.append(line)
        else:
            asides.append(line)
    return " ".join(bubbles)[:400], " ".join(asides)[:400]

def extract_html(html, page):
    import urllib.parse
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = re.sub("<[^>]+>", " ", title_m.group(1) if title_m else "")
    title = clean_scraper_text(re.sub(r"\s+", " ", title)).strip()[:180]
    body = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    body = re.sub(r"<style[\s\S]*?</style>", " ", body, flags=re.I)
    panels = []
    for match in re.finditer(r"<img\b[^>]*>", body, re.I):
        tag = match.group(0)
        src_m = re.search(r"(?:data-src|data-original|src)=[\"']([^\"']+)[\"']", tag, re.I)
        if not src_m:
            continue
        src = src_m.group(1).strip()
        if src.startswith("data:") or re.search(r"logo|icon|sprite|avatar|banner|ads?", src, re.I):
            continue
        src = urllib.parse.urljoin(page, src)
        alt_m = re.search(r"alt=[\"']([^\"']*)[\"']", tag, re.I)
        alt = alt_m.group(1).strip() if alt_m else ""
        after = re.sub("<[^>]+>", " ", body[match.end(): match.end() + 500])
        after = re.sub(r"\s+", " ", after).strip()[:400]
        panels.append({"src": src, "bubble": alt[:180], "aside": after, "text": (alt + " " + after).strip()[:500]})
        if len(panels) >= 80:
            break
    text = clean_scraper_text(re.sub("<[^>]+>", "\n", body))
    lines = []
    for line in text.splitlines():
        clean = re.sub(r"\s+", " ", line).strip()
        if not clean or re.search(r"next chapter|previous chapter|wtr-lab|sign in|cookie|set-cookie|ad[ -]?block|enable javascript and cookies", clean, re.I):
            continue
        lines.append(clean)
    return title, "\n".join(lines)[:20000], panels

def clean_scraper_text(text):
    text = re.sub(r"(?im)^[ \t]*(?:set-cookie|cookie)\s*:[^\n]*", "", text)
    text = re.sub(r"This is a cached snapshot[\s\S]*?\bprobe\b", " ", text, flags=re.I)
    text = re.sub(r"Ad Blocker Detected[\s\S]*?\bcontent[.!]?", " ", text, flags=re.I)
    text = re.sub(r"(?:please\s+)?(?:disable|turn off)\s+(?:your\s+)?ad[\s-]?block(?:er)?[^.!?\n]*[.!?]?", " ", text, flags=re.I)
    return text

def run_fetch(job_id, urls, cookie):
    import requests
    row = FETCH_JOBS[job_id]
    headers = {"User-Agent": "Mozilla/5.0"}
    if cookie:
        headers["Cookie"] = cookie
    pages = []
    try:
        for index, url in enumerate(urls, 1):
            row.update(label="Fetching %d of %d" % (index, len(urls)), progress=int(100 * index / len(urls)))
            try:
                res = requests.get(url, headers=headers, timeout=40)
                res.raise_for_status()
                title, text, panels = extract_html(res.text, url)
                pages.append({"url": url, "ok": True, "title": title, "text": text, "panels": panels})
            except Exception as exc:
                pages.append({"url": url, "ok": False, "error": str(exc)[:200], "title": "", "text": "", "panels": []})
            row["pages"] = pages
        row.update(status="done", progress=100, label="Fetch ready", error="")
    except Exception as exc:
        row.update(status="error", error=str(exc)[:300])

def place_panel(scene, dest, size, revoice):
    ensure_panel(scene, dest, size, revoice)


def save_image(raw, dest, size=(1920, 1080)):
    try:
        if fetch_image(raw, dest):
            return dest
    except Exception as exc:
        print("panel fetch failed", exc, flush=True)
    paint_prompt(raw if isinstance(raw, str) else "", dest, size)
    return dest

def render_job(job_id, packet):
    row = JOBS[job_id]
    try:
        aspect = packet.get("aspect") or "9:16"
        vertical = aspect != "16:9"
        W, H = (1080, 1920) if vertical else (1920, 1080)
        revoice = packet.get("pass") == "revoice"
        voice_id = "hi-IN-MadhurNeural" if packet.get("language") == "hi" else "en-US-ChristopherNeural"
        chapters = packet.get("chapters") or []
        scenes = []
        for chapter in chapters:
            for scene in chapter.get("scenes") or []:
                scenes.append(scene)
        if not scenes:
            raise RuntimeError("Job packet has no scenes.")
        row.update(progress=8, label="Re-voicing" if revoice else "Voice")
        repo = packet.get("image_repo") or ""
        if isinstance(repo, str) and repo.strip() and not revoice:
            os.environ["AETHER_IMAGE_REPO"] = repo.strip()[:200]
        timing = load_timing()
        audio_parts = []
        clips = []
        cues = []
        voices = {}
        cursor = 0.0
        lang = packet.get("language") or "en"
        for index, scene in enumerate(scenes, 1):
            bubble = scene.get("bubble") or {}
            spoken = " ".join(part for part in [scene.get("caption") or "", bubble.get("text") or ""] if part).strip() or " "
            sid = safe_id(scene.get("id") or ("p%d" % index))
            voice = VOICE_DIR / voice_file_name(sid, lang, voice_id)
            if not (voice.exists() and voice.stat().st_size > 200):
                speak_to(spoken[:700], voice_id, voice)
            voices[sid] = "/api/v1/voices/" + voice.name
            trimmed = OUT / f"{job_id}-v{index}.trim.mp3"
            sh(["ffmpeg", "-y", "-i", str(voice), "-af", "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB:stop_periods=0,apad=pad_dur=0.12", str(trimmed)])
            probe = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(trimmed)], text=True).strip()
            audio_hold = max(float(probe or "1.4"), 1.2)
            saved = timing.get(sid)
            try:
                packet_hold = float(scene.get("hold_sec") or 0)
            except Exception:
                packet_hold = 0
            base = float(saved) if saved is not None else (packet_hold if packet_hold > 0 else audio_hold)
            hold = max(base, audio_hold)
            if saved is None or hold > float(saved) + 0.05:
                timing[sid] = round(float(hold), 3)
                save_timing(timing)
            audio_parts.append(trimmed)
            img = OUT / f"{job_id}-p{index}.png"
            ensure_panel(scene, img, (W, H), revoice)
            clip = panel_clip(sid, img, hold, (W, H), scene.get("sfx") or "", revoice)
            clips.append(clip)
            cues.append((cursor, cursor + hold, spoken))
            cursor += hold
            row.update(progress=10 + int(70 * index / len(scenes)), label=("Re-voicing" if revoice else f"Panel {index}"), timing=timing, voices=voices)
        alist = OUT / f"{job_id}-alist.txt"
        alist.write_text("".join(f"file '{part.resolve()}'\n" for part in audio_parts))
        voice = OUT / f"{job_id}-voice.mp3"
        sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(alist), "-c:a", "libmp3lame", "-q:a", "4", str(voice)])
        duration = max(cursor, 1.2)
        lst = OUT / f"{job_id}-list.txt"
        lst.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
        silent = OUT / f"{job_id}-silent.mp4"
        sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
        def ts(sec):
            h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
            return f"{h}:{m:02d}:{s:05.2f}"
        events = []
        srt = []
        for i, (a, b, phrase) in enumerate(cues, 1):
            safe = phrase.replace("{", "(").replace("}", ")").replace("\n", " ")
            events.append("Dialogue: 0,%s,%s,Default,,0,0,0,,%s" % (ts(a), ts(b), safe))
            def srt_ts(sec):
                ms = int(round((sec - int(sec)) * 1000))
                return f"{int(sec // 3600):02d}:{int((sec % 3600) // 60):02d}:{int(sec % 60):02d},{ms:03d}"
            srt.append(f"{i}\n{srt_ts(a)} --> {srt_ts(b)}\n{safe}\n")
        (OUT / f"{job_id}.srt").write_text("\n".join(srt))
        align = 2
        margin = 220 if vertical else 80
        ass = OUT / f"{job_id}.ass"
        ass.write_text("\n".join([
            "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,Arial,{48 if vertical else 36},&H00F3EADB,&H0014110F,&H8014110F,-1,0,3,8,0,{align},48,48,{margin},1",
            "", "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events, "",
        ]))
        bgm = OUT / f"{job_id}-bgm.wav"
        dur = duration + 0.4
        sh(["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=55:duration={dur}", "-f", "lavfi", "-i", f"sine=frequency=82.5:duration={dur}", "-f", "lavfi", "-i", f"sine=frequency=110:duration={dur}:sample_rate=44100", "-filter_complex", f"[0:a]volume=0.35[a];[1:a]volume=0.16[b];[2:a]volume=0.08[c];[a][b][c]amix=inputs=3:normalize=0,lowpass=f=240,volume=0.22,afade=t=in:st=0:d=0.4,afade=t=out:st={max(dur-0.6,0.2)}:d=0.5", str(bgm)])
        mastered = OUT / f"{job_id}-mix.m4a"
        sh(["ffmpeg", "-y", "-i", str(voice), "-i", str(bgm), "-filter_complex", "[1:a]volume=0.18[b];[0:a][b]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=280[duck];[0:a][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95", "-c:a", "aac", str(mastered)])
        final = OUT / f"{job_id}.mp4"
        sub = str(ass).replace(":", "\\:").replace("'", "\\'")
        sh(["ffmpeg", "-y", "-i", str(silent), "-i", str(mastered), "-vf", f"ass={sub}", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(final)])
        preview = OUT / f"{job_id}-preview.mp4"
        sh(["ffmpeg", "-y", "-i", str(final), "-t", "6", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(preview)])
        lang = packet.get("language") or "en"
        stable = OUT / f"master_{lang}.mp4"
        shutil.copy(final, stable)
        srt_stable = OUT / f"captions_{lang}.srt"
        shutil.copy(OUT / f"{job_id}.srt", srt_stable)
        LATEST["preview"] = preview
        LATEST["mp4"] = str(stable)
        LATEST[f"master_{lang}"] = str(stable)
        LATEST[f"srt_{lang}"] = str(srt_stable)
        row.update(status="done", progress=100, label="Ready", mp4=str(stable), preview=str(preview), error="", timing=timing, voices=voices)
    except Exception as exc:
        row.update(status="error", error=str(exc)[:500], label="Re-voicing" if packet.get("pass") == "revoice" else "")

def youtube_upload(token, path, meta):
    import requests
    size = os.path.getsize(path)
    body = {
        "snippet": {
            "title": (meta.get("title") or "Manhua explanation")[:100],
            "description": (meta.get("description") or "")[:5000],
            "tags": list(meta.get("tags") or [])[:15],
            "categoryId": "24",
        },
        "status": {"privacyStatus": meta.get("privacy") or "private", "selfDeclaredMadeForKids": False},
    }
    init = requests.post(
        "https://www.googleapis.com/upload/youtube/v3/videos",
        params={"uploadType": "resumable", "part": "snippet,status"},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(size),
        },
        json=body, timeout=60,
    )
    init.raise_for_status()
    loc = init.headers["Location"]
    chunk_size = 8 * 1024 * 1024
    offset = 0
    video_id = None
    with open(path, "rb") as handle:
        while offset < size:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            end = offset + len(chunk) - 1
            put = requests.put(
                loc,
                data=chunk,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {offset}-{end}/{size}",
                },
                timeout=180,
            )
            if put.status_code not in (200, 201, 308):
                put.raise_for_status()
            offset = end + 1
            if put.status_code in (200, 201):
                video_id = put.json().get("id")
    if not video_id:
        raise RuntimeError("YouTube did not return a video id.")
    return video_id

def youtube_captions(token, video_id, srt_path, language):
    import requests
    meta = {"snippet": {"videoId": video_id, "language": language, "name": "English" if language == "en" else "Hindi", "isDraft": False}}
    with open(srt_path, "rb") as handle:
        files = {
            "snippet": ("snippet.json", json.dumps(meta), "application/json"),
            "file": (f"captions-{language}.srt", handle, "application/octet-stream"),
        }
        res = requests.post(
            "https://www.googleapis.com/upload/youtube/v3/captions",
            params={"part": "snippet", "uploadType": "multipart"},
            headers={"Authorization": f"Bearer {token}"},
            files=files,
            timeout=90,
        )
    if res.status_code >= 400:
        print("captions skipped", res.status_code, res.text[:180], flush=True)

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
@app.get("/api/v1/health")
def health():
    return {"ok": True, "gpus": GPU_COUNT, "names": GPU_NAMES, "engine": "aether-manhua", "local_ai": True}

@app.post("/api/generate")
@app.post("/api/v1/llm")
async def llm(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    mode = payload.get("model_mode") or "gguf"
    text = complete(mode, payload.get("system") or "", payload.get("prompt") or "")
    return {"text": text, "model": LLM.get("name"), "mode": mode}

@app.post("/api/v1/direct")
async def direct(request: Request):
    return await llm(request)

@app.post("/render")
@app.post("/api/v1/jobs")
async def create_job(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    packet = await request.json()
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"id": job_id, "status": "running", "progress": 5, "label": "Queued", "error": "", "mp4": None, "preview": None}
    threading.Thread(target=render_job, args=(job_id, packet), daemon=True).start()
    return {"id": job_id, "status": "queued"}

@app.get("/api/v1/jobs/{job_id}")
def job_status(job_id: str):
    row = JOBS.get(job_id)
    if not row:
        raise HTTPException(404, "missing job")
    return {"id": job_id, "status": row["status"], "progress": row["progress"], "label": row["label"], "error": row["error"], "mp4_url": f"/api/v1/jobs/{job_id}/mp4" if row["status"] == "done" else None, "timing": row.get("timing") or {}, "voices": row.get("voices") or {}}

@app.get("/api/v1/jobs/{job_id}/mp4")
def job_mp4(job_id: str):
    row = JOBS.get(job_id)
    if not row or not row.get("mp4"):
        raise HTTPException(404, "mp4 not ready")
    return FileResponse(row["mp4"], media_type="video/mp4")

@app.get("/api/v1/preview.mp4")
def preview():
    path = LATEST.get("preview")
    if not path or not Path(path).exists():
        raise HTTPException(404, "preview not ready")
    return FileResponse(path, media_type="video/mp4")

@app.get("/api/v1/masters/{lang}.mp4")
def master_file(lang: str, request: Request):
    if lang not in ("en", "hi"):
        raise HTTPException(404, "language")
    if not allowed(request.headers, request.query_params.get("token", "")):
        raise HTTPException(401, "token")
    path = LATEST.get(f"master_{lang}")
    if not path or not Path(path).exists():
        raise HTTPException(404, "that language master is not ready")
    return FileResponse(path, media_type="video/mp4", filename=f"master_{lang}.mp4")

@app.post("/api/v1/check")
async def check_panel(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    dest = OUT / "check-once.png"
    raw = payload.get("imageBase64") or ""
    try:
        if isinstance(raw, str) and len(raw) > 80:
            dest.write_bytes(base64.b64decode(raw))
        elif not fetch_image(payload.get("imageUrl") or "", dest):
            return {"match": "skipped", "note": "No picture reached the checker."}
    except Exception as exc:
        return {"match": "skipped", "note": str(exc)[:180]}
    verdict = vision_check(payload.get("prompt") or "", dest)
    if verdict["match"] is True:
        return {"match": "yes", "note": verdict["note"]}
    if verdict["match"] is False:
        return {"match": "no", "note": verdict["note"]}
    return {"match": "skipped", "note": verdict["note"]}

@app.post("/api/v1/paint")
async def paint(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    repo = (payload.get("repo") or "").strip()
    if repo:
        wanted = repo[:200]
        if PAINTER.get("name") != wanted:
            PAINTER.update(pipe=None, img2img=None, kind="", name="")
        os.environ["AETHER_IMAGE_REPO"] = wanted
    dest = OUT / "paint-once.png"
    reference = materialize_reference(payload)
    mode = paint_prompt(payload.get("prompt") or "panel", dest, (832, 1216), reference)
    return {"imageBase64": base64.b64encode(dest.read_bytes()).decode(), "mimeType": "image/png", "fallback": mode == "pollinations", "engine": mode, "referenceUsed": bool(reference)}

@app.post("/tts")
@app.post("/api/v1/speak")
async def speak(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    text = (payload.get("text") or " ")[:700]
    lang = "hi" if payload.get("language") == "hi" else "en"
    voice = "hi-IN-MadhurNeural" if lang == "hi" else "en-US-ChristopherNeural"
    sid = safe_id(payload.get("sceneId") or "line")
    dest = VOICE_DIR / voice_file_name(sid, lang, voice)
    if not (dest.exists() and dest.stat().st_size > 200 and not payload.get("force")):
        speak_to(text, voice, dest)
    data = dest.read_bytes()
    encoded = base64.b64encode(data).decode() if len(data) < 1_500_000 else ""
    return {"url": "/api/v1/voices/" + dest.name, "audioBase64": encoded, "mimeType": "audio/mpeg"}

@app.get("/api/v1/voices/{name}")
def voice_file(name: str, request: Request):
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", name):
        raise HTTPException(404, "voice")
    if not allowed(request.headers, request.query_params.get("token", "")):
        raise HTTPException(401, "token")
    path = VOICE_DIR / name
    if not path.exists():
        raise HTTPException(404, "voice not saved")
    return FileResponse(path, media_type="audio/mpeg")

@app.post("/extract")
@app.post("/api/v1/fetch")
async def start_fetch(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    urls = []
    for item in payload.get("urls") or []:
        if isinstance(item, str) and item.startswith("http") and len(urls) < 220:
            urls.append(item[:500])
    if not urls:
        raise HTTPException(400, "no urls")
    job_id = uuid.uuid4().hex[:12]
    FETCH_JOBS[job_id] = {"id": job_id, "status": "running", "progress": 1, "label": "Fetching", "error": "", "pages": []}
    threading.Thread(target=run_fetch, args=(job_id, urls, str(payload.get("cookie") or "")[:4000]), daemon=True).start()
    return {"id": job_id, "status": "queued"}

@app.get("/api/v1/fetch/{job_id}")
def fetch_status(job_id: str):
    if not re.fullmatch(r"[A-Za-z0-9]{6,32}", job_id):
        raise HTTPException(404, "missing fetch")
    row = FETCH_JOBS.get(job_id)
    if not row:
        raise HTTPException(404, "missing fetch")
    return {"id": job_id, "status": row["status"], "progress": row["progress"], "label": row["label"], "error": row["error"], "pages": row.get("pages") or []}

@app.post("/api/v1/ocr")
async def ocr(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    panels = []
    for item in (payload.get("images") or [])[:8]:
        if not isinstance(item, dict):
            continue
        dest = OUT / f"ocr-{len(panels)}.png"
        url = item.get("url") or ""
        raw_b64 = item.get("imageBase64") or ""
        try:
            if isinstance(raw_b64, str) and len(raw_b64) > 80:
                dest.write_bytes(base64.b64decode(raw_b64))
            elif not isinstance(url, str) or not fetch_image(url, dest):
                panels.append({"id": str(item.get("id") or ""), "bubble": "", "aside": "", "error": "image did not load"})
                continue
        except Exception as exc:
            panels.append({"id": str(item.get("id") or ""), "bubble": "", "aside": "", "error": str(exc)[:120]})
            continue
        bubble, aside = read_bubbles(dest)
        panels.append({"id": str(item.get("id") or ""), "bubble": bubble, "aside": aside})
    return {"panels": panels}

@app.post("/api/v1/youtube-upload")
async def upload(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    job_id = payload.get("jobId") or ""
    row = JOBS.get(job_id) or {}
    path = row.get("mp4") or LATEST.get(f"master_{payload.get('language') or 'en'}") or LATEST.get("mp4")
    if not path:
        raise HTTPException(404, "render the video first")
    video_id = youtube_upload(payload.get("accessToken") or "", path, payload)
    lang = payload.get("language") or "en"
    srt = LATEST.get(f"srt_{lang}")
    if srt and Path(srt).exists():
        try:
            youtube_captions(payload.get("accessToken") or "", video_id, srt, lang)
        except Exception as exc:
            print("captions skipped", exc, flush=True)
    return {"watchUrl": f"https://www.youtube.com/watch?v={video_id}"}

def boot():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")

threading.Thread(target=boot, daemon=True).start()
time.sleep(1.5)
bin_path = shutil.which("cloudflared")
if not bin_path:
    dest = Path("/tmp/cloudflared")
    subprocess.check_call(["curl", "-fsSL", "-o", str(dest), "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"])
    dest.chmod(0o755)
    bin_path = str(dest)
log = ROOT / "tunnel.log"
proc = subprocess.Popen([bin_path, "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--no-autoupdate"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
url = ""
for _ in range(80):
    line = proc.stdout.readline() if proc.stdout else ""
    if not line:
        time.sleep(0.2)
        continue
    log.write_text(log.read_text() + line if log.exists() else line)
    if "trycloudflare.com" in line:
        start = line.find("https://")
        if start >= 0:
            url = line[start:].strip().split()[0]
            break
print("WORKER_URL", url or "tunnel not ready yet — read aether tunnel log", flush=True)
print("Connection Done — paste WORKER_URL into the phone. Keys stay on the phone.", flush=True)
