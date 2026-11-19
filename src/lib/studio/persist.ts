import { createDefaultProject, sceneGraphV1Schema, type SceneGraphV1 } from "./schema";

const DB_NAME = "aether-studio-v2";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_REVISIONS = "revisions";
const STORE_RENDERS = "renders";
const FALLBACK_KEY = "aether.studio.v2.project";
const FALLBACK_REVS_KEY = "aether.studio.v2.revisions";

export interface ProjectRevisionEntry {
  revision_id: string;
  project_id: string;
  project_revision: number;
  saved_at: string;
  note: string;
  snapshot: SceneGraphV1;
}

export interface LocalRenderEntry {
  render_id: string;
  project_id: string;
  created_at: string;
  languages: string[];
  resolution: string;
  fps: number;
  packet_sha256: string;
  drive_folder?: string;
  report?: Record<string, unknown>;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "project_id" });
      }
      if (!db.objectStoreNames.contains(STORE_REVISIONS)) {
        const revStore = db.createObjectStore(STORE_REVISIONS, { keyPath: "revision_id" });
        revStore.createIndex("by_project", "project_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RENDERS)) {
        const renderStore = db.createObjectStore(STORE_RENDERS, { keyPath: "render_id" });
        renderStore.createIndex("by_project", "project_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function readLocalFallback(): SceneGraphV1 {
  if (typeof localStorage === "undefined") return createDefaultProject();
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return createDefaultProject();
    const parsed = sceneGraphV1Schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : createDefaultProject();
  } catch {
    return createDefaultProject();
  }
}

export async function loadActiveProject(): Promise<SceneGraphV1> {
  if (!hasIndexedDb()) return readLocalFallback();
  try {
    const db = await openDb();
    const rows = await new Promise<SceneGraphV1[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve((req.result as SceneGraphV1[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    if (rows.length === 0) {
      const starter = createDefaultProject();
      await saveProjectSnapshot(starter, "Initial starter project");
      return starter;
    }
    const sorted = [...rows].sort((a, b) => b.project_revision - a.project_revision);
    const parsed = sceneGraphV1Schema.safeParse(sorted[0]);
    return parsed.success ? parsed.data : createDefaultProject();
  } catch {
    return readLocalFallback();
  }
}

export async function saveProjectSnapshot(
  job: SceneGraphV1,
  note = "Autosave",
  recordRevision = false,
): Promise<void> {
  const validated = sceneGraphV1Schema.parse(job);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(validated));
    } catch {
      /* ignore quota */
    }
  }
  if (!hasIndexedDb()) {
    if (recordRevision && typeof localStorage !== "undefined") {
      try {
        const list = JSON.parse(localStorage.getItem(FALLBACK_REVS_KEY) ?? "[]") as ProjectRevisionEntry[];
        list.unshift({
          revision_id: `${validated.project_id}:r${validated.project_revision}:${Date.now()}`,
          project_id: validated.project_id,
          project_revision: validated.project_revision,
          saved_at: new Date().toISOString(),
          note,
          snapshot: validated,
        });
        localStorage.setItem(FALLBACK_REVS_KEY, JSON.stringify(list.slice(0, 20)));
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const stores = recordRevision ? [STORE_PROJECTS, STORE_REVISIONS] : [STORE_PROJECTS];
      const tx = db.transaction(stores, "readwrite");
      tx.objectStore(STORE_PROJECTS).put(validated);
      if (recordRevision) {
        const entry: ProjectRevisionEntry = {
          revision_id: `${validated.project_id}:r${validated.project_revision}:${Date.now()}`,
          project_id: validated.project_id,
          project_revision: validated.project_revision,
          saved_at: new Date().toISOString(),
          note,
          snapshot: validated,
        };
        tx.objectStore(STORE_REVISIONS).put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* fallback already saved */
  }
}

export async function listProjectRevisions(projectId: string): Promise<ProjectRevisionEntry[]> {
  if (!hasIndexedDb()) {
    if (typeof localStorage === "undefined") return [];
    try {
      const list = JSON.parse(localStorage.getItem(FALLBACK_REVS_KEY) ?? "[]") as ProjectRevisionEntry[];
      return list.filter((r) => r.project_id === projectId).slice(0, 15);
    } catch {
      return [];
    }
  }
  try {
    const db = await openDb();
    const rows = await new Promise<ProjectRevisionEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, "readonly");
      const index = tx.objectStore(STORE_REVISIONS).index("by_project");
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve((req.result as ProjectRevisionEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => b.saved_at.localeCompare(a.saved_at)).slice(0, 15);
  } catch {
    return [];
  }
}

export async function saveLocalRenderRecord(entry: LocalRenderEntry): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RENDERS, "readwrite");
      tx.objectStore(STORE_RENDERS).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function listLocalRenderRecords(projectId: string): Promise<LocalRenderEntry[]> {
  if (!hasIndexedDb()) return [];
  try {
    const db = await openDb();
    const rows = await new Promise<LocalRenderEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_RENDERS, "readonly");
      const index = tx.objectStore(STORE_RENDERS).index("by_project");
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve((req.result as LocalRenderEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12);
  } catch {
    return [];
  }
}
