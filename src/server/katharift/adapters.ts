import type {
  KrJobV1,
  KrSettingsSnapshot,
  KrStoryBible,
  KrTimelineV1,
} from "../../packages/contracts/schemas.ts";

export interface AdapterHealth {
  adapter_id: string;
  kind: "director" | "image" | "speech" | "compose" | "storage" | "export" | "event_sink";
  status: "ready" | "waiting_worker" | "unconfigured" | "quota_paused";
  detail: string;
}

export interface DirectorAdapter {
  readonly id: string;
  health(): Promise<AdapterHealth>;
  proposeOutline(prompt: string, bible: KrStoryBible): Promise<{ summary: string }>;
}

export interface ImageAdapter {
  readonly id: string;
  readonly baseline: KrSettingsSnapshot["image_baseline"];
  health(): Promise<AdapterHealth>;
}

export interface SpeechAdapter {
  readonly id: string;
  health(): Promise<AdapterHealth>;
}

export interface ComposeAdapter {
  readonly id: string;
  health(): Promise<AdapterHealth>;
}

export interface StorageAdapter {
  readonly id: string;
  health(): Promise<AdapterHealth>;
}

export interface ExportAdapter {
  readonly id: string;
  prepareSrt(timeline: KrTimelineV1, lang: "hi" | "en"): string;
  health(): Promise<AdapterHealth>;
}

export interface EventSink {
  readonly id: string;
  emit(job: KrJobV1, message: string): Promise<void>;
}

export const DEFAULT_ADAPTER_REGISTRY_SUMMARY: AdapterHealth[] = [
  {
    adapter_id: "kr_first_party_director_router_v1",
    kind: "director",
    status: "ready",
    detail: "First-party KathaRiftDirectorRouter active (paid_routes=false enforced).",
  },
  {
    adapter_id: "kr_flux2_klein_1344x768_v1",
    kind: "image",
    status: "waiting_worker",
    detail: "FLUX.2 Klein 4B rev e7b7dc27 + Qwen3 NF4/FP32 pre-encode @ 1344x768, restrained-v1.",
  },
  {
    adapter_id: "kr_bilingual_speech_v1",
    kind: "speech",
    status: "waiting_worker",
    detail: "HI/EN Edge-TTS & Colab Chatterbox/Indic-Parler (Kokoro hm_omega/am_michael excluded).",
  },
  {
    adapter_id: "kr_hyperframes_v1",
    kind: "compose",
    status: "waiting_worker",
    detail: "HyperFrames 0.9.81 + FFmpeg 48kHz/24fps worker pipeline.",
  },
  {
    adapter_id: "kr_google_drive_v1",
    kind: "storage",
    status: "unconfigured",
    detail: "Google Drive folder 15ek6wQirJz7d0DCLf6fvFWtMRvWpcLHx (connect in Connections).",
  },
  {
    adapter_id: "kr_timeline_export_v1",
    kind: "export",
    status: "ready",
    detail: "SRT/EDL exports ready on server; full edited MP4 renders via paired worker.",
  },
];
