/**
 * Focus-aware quality policy (MED-06).
 *
 * Management targets (approximate — applied via LiveKit APIs, not raw codecs):
 *   Grid thumbnails: ~180p–360p, low fps
 *   Focused screen:  ~720p, 10–15 fps
 *
 * Six full-resolution streams are an explicit risk; prefer adaptive layers +
 * one high-quality focused subscription.
 */

/** @typedef {'grid'|'focused'|'hidden'} QualityMode */

export const QUALITY_MODE = Object.freeze({
  GRID: 'grid',
  FOCUSED: 'focused',
  HIDDEN: 'hidden',
});

/**
 * Decide quality mode for a screen-share track.
 * @param {string} trackId
 * @param {string|null} focusedId
 * @param {{ isVisible?: boolean }} [opts]
 * @returns {QualityMode}
 */
export function qualityModeForTrack(trackId, focusedId, opts = {}) {
  if (!trackId) return QUALITY_MODE.HIDDEN;
  if (opts.isVisible === false && focusedId !== trackId) {
    return QUALITY_MODE.HIDDEN;
  }
  if (focusedId && focusedId === trackId) return QUALITY_MODE.FOCUSED;
  return QUALITY_MODE.GRID;
}

/**
 * LiveKit VideoQuality enum numeric values:
 *   LOW = 0, MEDIUM = 1, HIGH = 2
 * @param {QualityMode} mode
 * @returns {0|1|2|null} null means leave adaptiveStream alone / disable layer
 */
export function videoQualityForMode(mode) {
  switch (mode) {
    case QUALITY_MODE.FOCUSED:
      return 2; // HIGH
    case QUALITY_MODE.GRID:
      return 0; // LOW
    case QUALITY_MODE.HIDDEN:
    default:
      return null;
  }
}

/**
 * Suggested FPS for setVideoFPS when manually overriding.
 * @param {QualityMode} mode
 */
export function videoFpsForMode(mode) {
  switch (mode) {
    case QUALITY_MODE.FOCUSED:
      return 15;
    case QUALITY_MODE.GRID:
      return 5;
    default:
      return 0;
  }
}

/**
 * Suggested max dimensions for setVideoDimensions.
 * @param {QualityMode} mode
 * @returns {{ width: number, height: number }|null}
 */
export function videoDimensionsForMode(mode) {
  switch (mode) {
    case QUALITY_MODE.FOCUSED:
      return { width: 1280, height: 720 };
    case QUALITY_MODE.GRID:
      return { width: 640, height: 360 };
    default:
      return null;
  }
}

/**
 * Build a quality plan for all known screen tracks.
 * @param {string[]} trackIds
 * @param {string|null} focusedId
 */
export function buildQualityPlan(trackIds, focusedId) {
  const ids = Array.isArray(trackIds) ? trackIds : [];
  return ids.map((id) => {
    const mode = qualityModeForTrack(id, focusedId, {
      isVisible: !focusedId || focusedId === id,
    });
    return {
      trackId: id,
      mode,
      videoQuality: videoQualityForMode(mode),
      fps: videoFpsForMode(mode),
      dimensions: videoDimensionsForMode(mode),
      enabled: mode !== QUALITY_MODE.HIDDEN,
    };
  });
}
