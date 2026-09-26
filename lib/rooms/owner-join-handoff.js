/**
 * Same-tab handoff of the name and access code the owner just typed
 * while creating a room. Stored in sessionStorage only — never in the URL.
 */

export const OWNER_JOIN_HANDOFF_KEY = 'lkr-owner-join-handoff';
export const OWNER_JOIN_HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

const MIN_ACCESS_CODE_LENGTH = 12;
const MAX_DISPLAY_NAME_LENGTH = 40;

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Remember the owner's join credentials for this browser tab.
 * @returns {boolean} whether the handoff was stored
 */
export function saveOwnerJoinHandoff({
  slug,
  displayName,
  accessCode,
  ownerJoinToken,
}, storage, now = Date.now) {
  const store = resolveStorage(storage);
  if (!store || typeof slug !== 'string' || !slug) return false;

  const name = normalizeName(displayName);
  const code = typeof accessCode === 'string' ? accessCode : '';
  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH) return false;
  if (code.length < MIN_ACCESS_CODE_LENGTH) return false;

  try {
    const payload = {
      slug,
      displayName: name,
      accessCode: code,
      savedAt: now(),
    };
    if (typeof ownerJoinToken === 'string' && ownerJoinToken) {
      payload.ownerJoinToken = ownerJoinToken;
    }
    store.setItem(OWNER_JOIN_HANDOFF_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a still-valid handoff for this room slug.
 * @returns {{ displayName: string, accessCode: string, ownerJoinToken?: string } | null}
 */
export function readOwnerJoinHandoff(slug, storage, now = Date.now) {
  const store = resolveStorage(storage);
  if (!store || typeof slug !== 'string' || !slug) return null;

  let raw;
  try {
    raw = store.getItem(OWNER_JOIN_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || parsed.slug !== slug) return null;
  if (typeof parsed.savedAt !== 'number' || now() - parsed.savedAt > OWNER_JOIN_HANDOFF_MAX_AGE_MS) {
    clearOwnerJoinHandoff(store);
    return null;
  }

  const name = normalizeName(parsed.displayName);
  const code = typeof parsed.accessCode === 'string' ? parsed.accessCode : '';
  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH || code.length < MIN_ACCESS_CODE_LENGTH) {
    return null;
  }

  const result = { displayName: name, accessCode: code };
  if (typeof parsed.ownerJoinToken === 'string' && parsed.ownerJoinToken) {
    result.ownerJoinToken = parsed.ownerJoinToken;
  }
  return result;
}

export function clearOwnerJoinHandoff(storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(OWNER_JOIN_HANDOFF_KEY);
  } catch {
    // Ignore storage failures; the join form remains available.
  }
}
