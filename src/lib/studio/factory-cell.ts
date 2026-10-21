/** Paste-ready Colab T4 / Kaggle T4x2 cell. Not executed in the browser. */
export const FACTORY_CELL = `
# Aether Manhua Explanation Factory
# Colab T4 (15GB) or Kaggle T4x2 (30GB). Paste the whole cell and run.
# Printed Worker URL goes into the phone Settings. Nothing here is saved back to the phone.

import os, sys, json, uuid, time, shutil, threading, subprocess, base64
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
print("Full GLM-5.2 4-bit GGUF is about 466GB and will not fit Colab T4 or Kaggle T4x2. gguf mode loads a 4-bit distill (default GLM-4-9B Q4) unless AETHER_GGUF_REPO is set. Flagship GLM-5.2 stays on the cloud key (Z.ai / OpenRouter / GitHub Models).", flush=True)
if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
    subprocess.call(["apt-get", "update", "-qq"])
    subprocess.call(["apt-get", "install", "-y", "-qq", "ffmpeg"])

def sh(args, **kw):
    subprocess.check_call(args, **kw)

def allowed(headers):
    if not TOKEN:
        return True
    return headers.get("x-aether-token", "") == TOKEN

def han(text):
    return any("\\u4e00" <= ch <= "\\u9fff" for ch in text)

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
    user = system + "\\n\\n" + prompt
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

def save_image(raw, dest, size=(1920, 1080)):
    from PIL import Image
    if isinstance(raw, str) and raw.startswith("data:"):
        b64 = raw.split(",", 1)[-1]
        dest.write_bytes(base64.b64decode(b64))
        return dest
    if isinstance(raw, str) and raw.startswith("http"):
        import requests
        try:
            res = requests.get(raw, timeout=30)
            res.raise_for_status()
            dest.write_bytes(res.content)
            return dest
        except Exception as exc:
            print("panel fetch failed", exc, flush=True)
    ink_panel(raw if isinstance(raw, str) else "", dest, size)
    return dest

def render_job(job_id, packet):
    row = JOBS[job_id]
    try:
        aspect = packet.get("aspect") or "16:9"
        vertical = aspect == "9:16"
        W, H = (1080, 1920) if vertical else (1920, 1080)
        voice_id = (packet.get("voice") or "").strip() or ("hi-IN-MadhurNeural" if packet.get("language") == "hi" else "en-US-ChristopherNeural")
        chapters = packet.get("chapters") or []
        scenes = []
        notes = []
        hook = (packet.get("hook") or "").strip()
        if hook:
            notes.append(hook)
        for chapter in chapters:
            note = (chapter.get("narration") or "").strip()
            if note:
                notes.append(note)
            for scene in chapter.get("scenes") or []:
                scenes.append(scene)
        if not scenes:
            raise RuntimeError("Job packet has no scenes.")
        narration = " ".join(notes).strip() or packet.get("title") or "Manhua explanation"
        row.update(progress=15, label="Voice")
        import edge_tts, asyncio
        voice = OUT / f"{job_id}-voice.mp3"
        asyncio.run(edge_tts.Communicate(narration[:8000], voice_id).save(str(voice)))
        trimmed = OUT / f"{job_id}-voice.trim.mp3"
        sh(["ffmpeg", "-y", "-i", str(voice), "-af", "silenceremove=start_periods=1:start_silence=0.08:start_threshold=-40dB:stop_periods=-1:stop_silence=0.2:stop_threshold=-40dB", str(trimmed)])
        probe = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(trimmed)], text=True).strip()
        duration = max(float(probe or "8"), 4.0)
        row.update(progress=40, label="Panels")
        clips = []
        each = max(2.4, duration / max(len(scenes), 1))
        for index, scene in enumerate(scenes, 1):
            img = OUT / f"{job_id}-p{index}.png"
            save_image(scene.get("image_url") or (scene.get("tiles") or [{}])[0].get("prompt") or "", img, (W, H))
            clip = OUT / f"{job_id}-c{index}.mp4"
            frames = max(int(each * 30), 48)
            sfx = (scene.get("sfx") or "")
            shake = "shake" in sfx.lower() or sfx in ("CRACK", "BOOM", "SHING")
            vf = f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},zoompan=z='min(1.0+0.0012*on,1.22)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+on*0.45':d={frames}:s={W}x{H}:fps=30"
            if shake:
                vf += f",crop=iw-24:ih-24:12+8*sin(n*2):12+6*cos(n*3),scale={W}:{H},fade=t=in:st=0:d=0.12:color=white"
            vf += ",fade=t=in:st=0:d=0.25,fade=t=out:st=" + str(max(each - 0.25, 0.3)) + ":d=0.25,format=yuv420p"
            sh(["ffmpeg", "-y", "-loop", "1", "-i", str(img), "-vf", vf, "-t", str(each), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip)])
            clips.append(clip)
            row.update(progress=40 + int(30 * index / len(scenes)), label=f"Panel {index}")
        lst = OUT / f"{job_id}-list.txt"
        lst.write_text("".join(f"file '{c.resolve()}'\\n" for c in clips))
        silent = OUT / f"{job_id}-silent.mp4"
        sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
        words = narration.split()
        phrases = [" ".join(words[i:i+4]) for i in range(0, len(words), 4)] or [narration[:80]]
        step = duration / max(len(phrases), 1)
        ass = OUT / f"{job_id}.ass"
        events = []
        for i, phrase in enumerate(phrases):
            a = i * step
            b = min(duration, (i + 1) * step)
            def ts(sec):
                h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
                return f"{h}:{m:02d}:{s:05.2f}"
            safe = phrase.replace("{", "(").replace("}", ")")
            events.append("Dialogue: 0,%s,%s,Default,,0,0,0,,{\\\\blur3\\\\bord3\\\\3c&H00331A14&}%s" % (ts(a), ts(b), safe))
        align = 2 if vertical else 2
        margin = 220 if vertical else 80
        ass.write_text("\\n".join([
            "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,Arial,{54 if vertical else 42},&H00F3EADB,&H0014110F,&H80000000,-1,0,1,3,2,{align},40,40,{margin},1",
            "", "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events, "",
        ]))
        bgm = OUT / f"{job_id}-bgm.wav"
        dur = duration + 1
        sh(["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=55:duration={dur}", "-f", "lavfi", "-i", f"sine=frequency=82.5:duration={dur}", "-f", "lavfi", "-i", f"sine=frequency=110:duration={dur}:sample_rate=44100", "-filter_complex", f"[0:a]volume=0.55[a];[1:a]volume=0.28[b];[2:a]volume=0.12[c];[a][b][c]amix=inputs=3:normalize=0,lowpass=f=240,volume=0.32,afade=t=in:st=0:d=0.8,afade=t=out:st={max(dur-1.2,0.2)}:d=1", str(bgm)])
        mastered = OUT / f"{job_id}-mix.m4a"
        sh(["ffmpeg", "-y", "-i", str(trimmed), "-i", str(bgm), "-filter_complex", "[1:a]volume=0.20[b];[0:a][b]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=300[duck];[0:a][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95", "-c:a", "aac", str(mastered)])
        final = OUT / f"{job_id}.mp4"
        sub = str(ass).replace(":", "\\\\:").replace("'", "\\\\'")
        sh(["ffmpeg", "-y", "-i", str(silent), "-i", str(mastered), "-vf", f"ass={sub}", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(final)])
        preview = OUT / f"{job_id}-preview.mp4"
        sh(["ffmpeg", "-y", "-i", str(final), "-t", "6", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(preview)])
        LATEST["preview"] = preview
        LATEST["mp4"] = final
        row.update(status="done", progress=100, label="Ready", mp4=str(final), preview=str(preview), error="")
    except Exception as exc:
        row.update(status="error", error=str(exc)[:500], label="")

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
    with open(path, "rb") as handle:
        put = requests.put(
            loc,
            data=handle,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "video/mp4", "Content-Length": str(size)},
            timeout=900,
        )
    put.raise_for_status()
    video_id = put.json().get("id")
    if not video_id:
        raise RuntimeError(put.text[:300])
    return f"https://www.youtube.com/watch?v={video_id}"

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/v1/health")
def health():
    return {"ok": True, "gpus": GPU_COUNT, "names": GPU_NAMES, "engine": "aether-manhua", "local_ai": True}

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
    return {"id": job_id, "status": row["status"], "progress": row["progress"], "label": row["label"], "error": row["error"], "mp4_url": f"/api/v1/jobs/{job_id}/mp4" if row["status"] == "done" else None}

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

@app.post("/api/v1/paint")
async def paint(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    dest = OUT / "paint-once.png"
    ink_panel(payload.get("prompt") or "panel", dest, (1080, 1620))
    return {"imageBase64": base64.b64encode(dest.read_bytes()).decode(), "mimeType": "image/png"}

@app.post("/api/v1/speak")
async def speak(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    import edge_tts, asyncio
    payload = await request.json()
    text = (payload.get("text") or "")[:700]
    voice = payload.get("voice") or "en-US-ChristopherNeural"
    dest = OUT / "speak-once.mp3"
    asyncio.run(edge_tts.Communicate(text or " ", voice).save(str(dest)))
    return {"audioBase64": base64.b64encode(dest.read_bytes()).decode(), "mimeType": "audio/mpeg"}

@app.post("/api/v1/youtube-upload")
async def upload(request: Request):
    if not allowed(request.headers):
        raise HTTPException(401, "token")
    payload = await request.json()
    job_id = payload.get("jobId") or ""
    row = JOBS.get(job_id) or {}
    path = row.get("mp4") or LATEST.get("mp4")
    if not path:
        raise HTTPException(404, "render the video first")
    watch = youtube_upload(payload.get("accessToken") or "", path, payload)
    return {"watchUrl": watch}

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
`.trim();
