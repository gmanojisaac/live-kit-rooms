/**
 * LiveKit Room options for the Next.js media room (MED-06).
 *
 * Explicitly enables:
 *   - adaptiveStream — subscribe quality based on attached element size / visibility
 *   - dynacast — pause unused published layers for subscribers who don't need them
 *
 * Screen-share publish defaults target low-fps grid layers + a ~720p focused layer.
 * Enabled here so callers do not rely on undocumented SDK defaults alone.
 */

/**
 * Build RoomOptions for LiveKitRoom / new Room().
 * Accepts VideoPresets / ScreenSharePresets from livekit-client so this module
 * stays free of a hard runtime import (tests can pass stubs).
 *
 * @param {{
 *   VideoPresets?: { h180?: { encoding?: object }, h360?: { encoding?: object } },
 *   ScreenSharePresets?: {
 *     h360fps3?: { encoding?: object, resolution?: object },
 *     h720fps15?: { encoding?: object, resolution?: object },
 *   },
 * }} [presets]
 */
export function createMediaRoomOptions(presets = {}) {
  const ss = presets.ScreenSharePresets || {};
  const low = ss.h360fps3;
  const high = ss.h720fps15;

  /** @type {Record<string, unknown>} */
  const options = {
    // MED-06 — explicit, not relying on SDK defaults
    adaptiveStream: true,
    dynacast: true,
    // Camera stays off until the user enables it (MED-02 / camera default)
    videoCaptureDefaults: {
      resolution: presets.VideoPresets?.h360?.resolution,
    },
    publishDefaults: {
      simulcast: true,
      // Prefer clarity for screen content when bandwidth is constrained
      degradationPreference: 'maintain-resolution',
      screenShareEncoding: high?.encoding || {
        maxBitrate: 1_500_000,
        maxFramerate: 15,
      },
      // Low layer for grid thumbnails (~360p / low fps)
      screenShareSimulcastLayers: low
        ? [low]
        : [],
    },
  };

  return options;
}

/**
 * Documented constants for diagnostics / docs (not secrets).
 */
export const MEDIA_QUALITY_POLICY_SUMMARY = Object.freeze({
  adaptiveStream: true,
  dynacast: true,
  gridTarget: '≈180p–360p · ~5 fps (via adaptive + LOW layer)',
  focusedTarget: '≈720p · 10–15 fps (HIGH layer while focused)',
  cameraDefault: 'off',
  maxSimultaneousScreenShares: 6,
});
