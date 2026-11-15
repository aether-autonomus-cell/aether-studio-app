export const COLAB_WORKER_RAW_URLS = [
  "https://raw.githubusercontent.com/aether-autonomus-cell/aether-studio-app/arena/6fe97187-aether-studio-app/colab_worker.py",
  "https://raw.githubusercontent.com/aether-autonomus-cell/aether-studio-app/main/colab_worker.py",
] as const;

export const FACTORY_CELL = `# Aether Studio Autonomous Factory Cell — Bootstrapper
# Paste this compact cell into Google Colab (T4) or Kaggle (T4x2) and run.
import urllib.request, pathlib

urls = [
    "https://raw.githubusercontent.com/aether-autonomus-cell/aether-studio-app/arena/6fe97187-aether-studio-app/colab_worker.py",
    "https://raw.githubusercontent.com/aether-autonomus-cell/aether-studio-app/main/colab_worker.py",
]
dest = pathlib.Path("colab_worker.py")
for url in urls:
    try:
        urllib.request.urlretrieve(url, dest)
        if dest.stat().st_size > 1000:
            break
    except Exception:
        continue
exec(compile(dest.read_text(), str(dest), "exec"), {"__name__": "__main__"})
`;
