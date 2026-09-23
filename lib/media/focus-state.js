/**
 * Focus-mode state helpers for the six-screen grid (MED-05).
 * Pure functions — safe for unit tests without LiveKit.
 */

/**
 * @param {string|null} focusedId
 * @param {Iterable<string>} availableIds
 * @returns {string|null}
 */
export function resolveFocusId(focusedId, availableIds) {
  if (!focusedId) return null;
  const set = availableIds instanceof Set
    ? availableIds
    : new Set(availableIds);
  return set.has(focusedId) ? focusedId : null;
}

/**
 * When the focused track disappears, return to grid (null).
 * @param {string|null} focusedId
 * @param {Array<{ id: string }>} tracks
 */
export function nextFocusAfterTrackChange(focusedId, tracks) {
  if (!focusedId) return null;
  const stillThere = tracks.some((t) => t.id === focusedId);
  return stillThere ? focusedId : null;
}

/**
 * Should Escape return to grid?
 * Avoids trapping keyboard / closing focus while typing in inputs.
 * @param {KeyboardEvent| { key?: string, target?: EventTarget|null }} event
 * @param {string|null} focusedId
 */
export function shouldHandleEscapeToGrid(event, focusedId) {
  if (!focusedId) return false;
  if (!event || event.key !== 'Escape') return false;

  const target = event.target;
  if (target && typeof target === 'object') {
    const el = /** @type {HTMLElement} */ (target);
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
    if (el.isContentEditable) return false;
  }

  return true;
}

/**
 * Toggle or set focus on a track id.
 * Clicking the already-focused tile keeps it focused (use explicit return).
 * @param {string|null} current
 * @param {string} trackId
 */
export function selectFocusTarget(current, trackId) {
  if (!trackId) return current;
  return trackId;
}

export function clearFocus() {
  return null;
}
