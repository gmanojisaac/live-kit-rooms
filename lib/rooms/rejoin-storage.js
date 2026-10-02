/**
 * Client-side storage for participant rejoin tokens (session-scoped).
 * Never put rejoin tokens in the URL.
 */

export const REJOIN_STORAGE_KEY = 'lkr-rejoin-tokens';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

function readMap(store) {
  try {
    const raw = store.getItem(REJOIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(store, map) {
  try {
    store.setItem(REJOIN_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
export function saveRejoinToken(slug, rejoinToken, storage) {
  const store = resolveStorage(storage);
  if (!store || typeof slug !== 'string' || !slug) return false;
  if (typeof rejoinToken !== 'string' || !rejoinToken) return false;
  const map = readMap(store);
  map[slug] = rejoinToken;
  return writeMap(store, map);
}

/**
 * @returns {string|null}
 */
export function readRejoinToken(slug, storage) {
  const store = resolveStorage(storage);
  if (!store || typeof slug !== 'string' || !slug) return null;
  const value = readMap(store)[slug];
  return typeof value === 'string' && value ? value : null;
}

/**
 * @returns {boolean}
 */
export function clearRejoinToken(slug, storage) {
  const store = resolveStorage(storage);
  if (!store || typeof slug !== 'string' || !slug) return false;
  const map = readMap(store);
  if (!(slug in map)) return false;
  delete map[slug];
  return writeMap(store, map);
}
