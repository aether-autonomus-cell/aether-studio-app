export const DEFAULT_GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/aether-autonomus-cell/aether-studio-app/main";

export function generateColabCell1Preflight(baseUrl = DEFAULT_GITHUB_RAW_BASE): string {
  return `# Cell 1 — Aether Studio v2 Preflight & Bootstrapper (Colab CPU or T4 GPU)
import pathlib, subprocess, sys, urllib.request
BASE = "${baseUrl}"
pathlib.Path("/content/colab_worker.py").write_bytes(
    urllib.request.urlopen(f"{BASE}/colab_worker.py", timeout=30).read()
)
subprocess.run(
    [sys.executable, "/content/colab_worker.py", "preflight", "--base-url", BASE],
    check=True,
)`;
}

export function generateColabCell2Render(mode: "mode-a" | "mode-b" = "mode-a"): string {
  if (mode === "mode-b") {
    return `# Cell 2 — Cloud Pairing Render (Mode B)
import getpass, subprocess, sys
code = getpass.getpass("12-char Pairing Code: ").strip()
origin = input("Vercel Studio Origin (https://...): ").strip()
subprocess.run(
    [sys.executable, "/content/colab_worker.py", "render", "--origin", origin, "--pair-code", code],
    check=True,
)`;
  }
  return `# Cell 2 — Instant Zero-Setup Render & Drive Save (Mode A)
import pathlib, subprocess, sys
# Paste Job Packet JSON below OR upload aether_job.json to /content/aether_job.json
JOB_JSON = r'''PASTE_AETHER_JOB_JSON_HERE'''
job_path = pathlib.Path("/content/aether_job.json")
if "PASTE_AETHER_JOB_JSON_HERE" not in JOB_JSON:
    job_path.write_text(JOB_JSON, encoding="utf-8")
subprocess.run(
    [sys.executable, "/content/colab_worker.py", "render", "--job", str(job_path)],
    check=True,
)`;
}

export function generateColabCell3Publish(): string {
  return `# Cell 3 — Optional Dual-Channel Direct YouTube Publish (Zero Phone Download)
import pathlib, subprocess, sys
MANIFEST_JSON = r'''PASTE_PUBLISH_MANIFEST_JSON_HERE'''
manifest_path = pathlib.Path("/content/publish_manifest.json")
if "PASTE_PUBLISH_MANIFEST_JSON_HERE" not in MANIFEST_JSON:
    manifest_path.write_text(MANIFEST_JSON, encoding="utf-8")
subprocess.run(
    [sys.executable, "/content/colab_worker.py", "publish", "--manifest", str(manifest_path)],
    check=True,
)`;
}

export function generateColabOptionalLlmCell(): string {
  return `# Optional Tier 2 — Colab Local Open-Source Story/Translation LLM (Zero Paid Keys)
# Run only if Pollinations is rate-limited and you want local LLM JSON structuring
import json, subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "transformers", "accelerate"], check=True)
print("Load Qwen/Qwen2.5-1.5B-Instruct on Colab GPU/CPU and paste structured JSON back into Tab 1.")`;
}
