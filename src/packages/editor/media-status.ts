import type { KrSceneCheckpoint, KrTimelineClip } from "../contracts/schemas.ts";

/**
 * Honest 4-state media readiness lifecycle.
 *
 * CRITICAL INVARIANT: Mere presence of an image/audio URL or Drive file ID NEVER
 * marks an asset as `"validated"` / playable. An asset starts as `"pending"` (no ref)
 * or `"available"` (URL/Drive ID exists, unverified), and only moves to `"validated"`
 * once browser media decode/load succeeds (or `"playback_error"` if it fails).
 */
export type MediaLifecycleState =
  | "pending"
  | "available"
  | "validated"
  | "playback_error";

export type MediaRuntimeProbe = "unprobed" | "validated" | "playback_error";

export type MediaProbeMap = Record<string, MediaRuntimeProbe>;

export interface MediaStateDetail {
  state: MediaLifecycleState;
  url: string | null;
  driveId: string | null;
  workerVerified: boolean;
  reason: string;
}

export interface ClipMediaStatus {
  picture: MediaStateDetail & {
    kind: "video" | "image" | "storyboard";
  };
  hiAudio: MediaStateDetail;
  enAudio: MediaStateDetail;
}

export function classifyMediaAssetState(params: {
  url: string | null | undefined;
  driveId: string | null | undefined;
  checkpointStatus?: KrSceneCheckpoint["status"];
  checkpointVerified?: boolean;
  checkpointError?: string | null;
  probeState?: MediaRuntimeProbe;
  kindLabel: string;
}): MediaStateDetail {
  const url = params.url && params.url.trim().length > 0 ? params.url.trim() : null;
  const driveId =
    params.driveId && params.driveId.trim().length > 0 ? params.driveId.trim() : null;
  const workerVerified = Boolean(params.checkpointVerified);

  if (params.probeState === "playback_error") {
    return {
      state: "playback_error",
      url,
      driveId,
      workerVerified,
      reason: `${params.kindLabel} failed browser load/playback verification.`,
    };
  }

  if (params.checkpointStatus === "failed" && !url) {
    return {
      state: "playback_error",
      url,
      driveId,
      workerVerified,
      reason: params.checkpointError || `${params.kindLabel} failed in worker stage.`,
    };
  }

  if (url) {
    if (params.probeState === "validated") {
      return {
        state: "validated",
        url,
        driveId,
        workerVerified,
        reason: `${params.kindLabel} verified playable in browser.`,
      };
    }
    return {
      state: "available",
      url,
      driveId,
      workerVerified,
      reason: `${params.kindLabel} URL available · awaiting browser load verification.`,
    };
  }

  if (driveId) {
    return {
      state: "available",
      url: null,
      driveId,
      workerVerified,
      reason: `${params.kindLabel} Drive ID stored · no browser-playable URL attached yet.`,
    };
  }

  return {
    state: "pending",
    url: null,
    driveId: null,
    workerVerified: false,
    reason: `${params.kindLabel} pending worker render.`,
  };
}

export function classifyClipMediaStatus(
  clip: KrTimelineClip,
  checkpoint?: KrSceneCheckpoint | null,
  probeMap: MediaProbeMap = {},
): ClipMediaStatus {
  const pictureUrl = clip.video_url || clip.image_url || null;
  const pictureDriveId = clip.drive_mp4_id || clip.drive_image_id || checkpoint?.image_drive_id || null;
  const pictureBase = classifyMediaAssetState({
    url: pictureUrl,
    driveId: pictureDriveId,
    checkpointStatus: checkpoint?.status,
    checkpointVerified: checkpoint?.verified,
    checkpointError: checkpoint?.error_message,
    probeState: pictureUrl ? probeMap[pictureUrl] : undefined,
    kindLabel: clip.video_url ? "Video" : "Picture plate",
  });

  const pictureKind: "video" | "image" | "storyboard" =
    pictureBase.state === "validated"
      ? clip.video_url
        ? "video"
        : "image"
      : pictureBase.state === "available" && pictureUrl
        ? clip.video_url
          ? "video"
          : "image"
        : "storyboard";

  const hiAudio = classifyMediaAssetState({
    url: clip.hi_audio_url,
    driveId: checkpoint?.hi_audio_drive_id,
    checkpointStatus: checkpoint?.status,
    checkpointVerified: checkpoint?.verified,
    checkpointError: checkpoint?.error_message,
    probeState: clip.hi_audio_url ? probeMap[clip.hi_audio_url] : undefined,
    kindLabel: "Hindi audio",
  });

  const enAudio = classifyMediaAssetState({
    url: clip.en_audio_url,
    driveId: checkpoint?.en_audio_drive_id,
    checkpointStatus: checkpoint?.status,
    checkpointVerified: checkpoint?.verified,
    checkpointError: checkpoint?.error_message,
    probeState: clip.en_audio_url ? probeMap[clip.en_audio_url] : undefined,
    kindLabel: "English audio",
  });

  return {
    picture: {
      ...pictureBase,
      kind: pictureKind,
    },
    hiAudio,
    enAudio,
  };
}

export function getAudioPlaybackStatusSummary(
  status: MediaStateDetail,
  lang: "hi" | "en",
): {
  canAttemptPlayback: boolean;
  isVerifiedPlayable: boolean;
  isSilentStoryboard: boolean;
  badgeText: string;
  detailText: string;
} {
  const langLabel = lang.toUpperCase();
  if (status.state === "validated" && status.url) {
    return {
      canAttemptPlayback: true,
      isVerifiedPlayable: true,
      isSilentStoryboard: false,
      badgeText: `${langLabel} Audio Verified`,
      detailText: `${langLabel} audio stream verified playable.`,
    };
  }
  if (status.state === "available" && status.url) {
    return {
      canAttemptPlayback: true,
      isVerifiedPlayable: false,
      isSilentStoryboard: false,
      badgeText: `${langLabel} Audio Available (Unverified)`,
      detailText: `${langLabel} audio URL present — tap Play to verify browser playback.`,
    };
  }
  if (status.state === "playback_error") {
    return {
      canAttemptPlayback: false,
      isVerifiedPlayable: false,
      isSilentStoryboard: true,
      badgeText: `${langLabel} Playback Error`,
      detailText: status.reason,
    };
  }
  if (status.state === "available" && !status.url) {
    return {
      canAttemptPlayback: false,
      isVerifiedPlayable: false,
      isSilentStoryboard: true,
      badgeText: "Silent Storyboard (Drive Only)",
      detailText: `${langLabel} Drive ID exists, but no streamable audio URL is attached — silent storyboard mode.`,
    };
  }
  return {
    canAttemptPlayback: false,
    isVerifiedPlayable: false,
    isSilentStoryboard: true,
    badgeText: "Silent Storyboard",
    detailText: `No ${langLabel} audio rendered yet — silent storyboard playback.`,
  };
}
