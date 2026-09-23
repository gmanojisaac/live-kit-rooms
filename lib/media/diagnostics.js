/**
 * Lightweight media diagnostics for development / QA (MED-39).
 * Never log secrets, tokens, prompt content, or screen pixels.
 */

/**
 * @param {{
 *   connectionState?: string,
 *   reconnectCount?: number,
 *   participantCount?: number,
 *   screenShareCount?: number,
 *   networkQuality?: string,
 *   focusedTrackId?: string|null,
 *   dynacast?: boolean,
 *   adaptiveStream?: boolean,
 * }} snapshot
 */
export function sanitizeMediaDiagnostics(snapshot = {}) {
  return {
    connectionState: snapshot.connectionState || 'unknown',
    reconnectCount: Number(snapshot.reconnectCount) || 0,
    participantCount: Number(snapshot.participantCount) || 0,
    screenShareCount: Number(snapshot.screenShareCount) || 0,
    networkQuality: snapshot.networkQuality || 'unknown',
    focusedTrackId: snapshot.focusedTrackId ? 'set' : 'none',
    dynacast: Boolean(snapshot.dynacast),
    adaptiveStream: Boolean(snapshot.adaptiveStream),
  };
}

/**
 * Safe console debug helper — no-ops unless window.__LKR_MEDIA_DEBUG is true.
 * @param {ReturnType<typeof sanitizeMediaDiagnostics>} data
 */
export function logMediaDiagnostics(data) {
  if (typeof window === 'undefined') return;
  if (!window.__LKR_MEDIA_DEBUG) return;
  // eslint-disable-next-line no-console
  console.info('[lkr-media]', sanitizeMediaDiagnostics(data));
}
