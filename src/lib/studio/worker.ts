const PATHS = [
  "/api/v1/health",
  "/api/v1/jobs",
  "/api/v1/direct",
  "/api/v1/paint",
  "/api/v1/speak",
  "/api/v1/llm",
  "/api/v1/youtube-upload",
  "/api/v1/preview.mp4",
  "/api/v1/check",
  "/api/v1/fetch",
  "/api/v1/ocr",
] as const;

export type WorkerPath = (typeof PATHS)[number];

export function workerEndpoint(raw: string, path: string): URL {
  if (!path.startsWith("/api/v1/") || path.includes("..") || path.includes("//")) {
    throw new Error("That worker path is not valid.");
  }
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Add the worker URL first.");
  let origin: URL;
  try {
    origin = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("That worker URL is not valid.");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("Only http and https workers.");
  }
  let prefix = origin.pathname.replace(/\/+$/, "");
  if (prefix.endsWith("/api/v1/health")) prefix = prefix.slice(0, -"/api/v1/health".length);
  else if (prefix.endsWith("/api/v1/jobs")) prefix = prefix.slice(0, -"/api/v1/jobs".length);
  else if (prefix.endsWith("/api/v1")) prefix = prefix.slice(0, -"/api/v1".length);
  const next = new URL(origin.origin);
  next.pathname = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  return next;
}
