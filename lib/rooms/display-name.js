/**
 * Display-name validation for participant join.
 * Display names are metadata only — never used as LiveKit identity.
 */

export const MIN_DISPLAY_NAME_LENGTH = 1;
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * Normalize and validate a participant display name.
 * @returns {{ ok: true, displayName: string } | { ok: false, reason: string }}
 */
export function normalizeDisplayName(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'INVALID_DISPLAY_NAME' };
  }

  const displayName = value.trim().replace(/\s+/g, ' ');
  if (
    displayName.length < MIN_DISPLAY_NAME_LENGTH
    || displayName.length > MAX_DISPLAY_NAME_LENGTH
  ) {
    return { ok: false, reason: 'INVALID_DISPLAY_NAME' };
  }

  return { ok: true, displayName };
}
