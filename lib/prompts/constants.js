/**
 * Prompt collaboration constants (Phase 4).
 * Never log full prompt text or raw Yjs payloads.
 */

/** Shared Y.Text key inside the room-scoped Y.Doc. */
export const YJS_PROMPT_KEY = 'prompt';

/** LiveKit data-channel topics (room-scoped by LiveKit membership). */
export const YJS_SYNC_TOPIC = 'prompt-yjs-sync';
export const YJS_UPDATE_TOPIC = 'prompt-yjs-update';
export const YJS_AWARENESS_TOPIC = 'prompt-yjs-awareness';
export const PROMPT_META_TOPIC = 'prompt-meta';

/** Debounce before persisting a durable snapshot to Supabase. */
export const SNAPSHOT_DEBOUNCE_MS = 1_200;

/** How long a late joiner waits for peer sync before seeding from the server snapshot. */
export const LATE_JOIN_PEER_WAIT_MS = 900;

/** Poll interval for authoritative lock / room-status (not draft text). */
export const LOCK_STATUS_POLL_MS = 4_000;

export const MAX_PROMPT_LENGTH = 50_000;

/** Fallback version name when the user leaves name blank (documented). */
export function defaultVersionName(versionNumber) {
  return `Version ${versionNumber}`;
}
