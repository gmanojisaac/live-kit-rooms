/**
 * Room-access policy knobs for unresolved Product Owner decisions.
 * Defaults are provisional (management recommendations), not approved product decisions.
 *
 * Outstanding: D-02 (who may create), D-03 (default expiry), D-04 (invite max uses), D-06 (owner approval).
 */

export const ROOM_STATUSES = Object.freeze(['active', 'ended', 'expired']);
export const ROOM_STATUS = Object.freeze({
  ACTIVE: 'active',
  ENDED: 'ended',
  EXPIRED: 'expired',
});

export const MAX_PARTICIPANTS = 6;

/** Provisional pending D-03 — management recommendation only. */
export const PROVISIONAL_DEFAULT_EXPIRY_MINUTES = 90;

/** Provisional pending D-04 — management recommendation only. */
export const PROVISIONAL_INVITE_DEFAULT_MAX_USES = 6;

/** Provisional pending D-02 — open creation until a host policy is chosen. */
export const PROVISIONAL_ROOM_CREATION_MODE = 'open';

export const ROOM_CREATION_MODES = Object.freeze(['open', 'host_secret']);

/** Access-code length floor for creation (do not weaken for convenience). */
export const MIN_ACCESS_CODE_LENGTH = 12;
export const MAX_ACCESS_CODE_LENGTH = 128;
export const MAX_ROOM_TITLE_LENGTH = 120;

/** Conservative room-creation abuse limit (configurable; not a business-policy lock). */
export const PROVISIONAL_ROOM_CREATION_MAX_ATTEMPTS = 10;
export const PROVISIONAL_ROOM_CREATION_WINDOW_MS = 15 * 60 * 1000;

/** Join / access-code failure policy — management source of truth. */
export const JOIN_RATE_LIMIT_MAX_FAILURES = 5;
export const JOIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Short-lived LiveKit JWT ceiling (capped further by remaining room lifetime). */
export const DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS = 3600;
export const MIN_LIVEKIT_TOKEN_TTL_SECONDS = 30;

export const OWNER_SESSION_COOKIE = 'lkr_owner_session';
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function read(name, env) {
  const value = env[name];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parsePositiveInt(raw, fallback) {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Resolve room policy from environment. Call only on the server.
 */
export function getRoomPolicy(env = process.env) {
  const creationModeRaw = read('ROOM_CREATION_MODE', env).toLowerCase()
    || PROVISIONAL_ROOM_CREATION_MODE;
  const creationMode = ROOM_CREATION_MODES.includes(creationModeRaw)
    ? creationModeRaw
    : PROVISIONAL_ROOM_CREATION_MODE;

  return {
    creationMode,
    creationSecret: read('ROOM_CREATION_SECRET', env),
    defaultExpiryMinutes: parsePositiveInt(
      read('ROOM_DEFAULT_EXPIRY_MINUTES', env),
      PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
    ),
    inviteDefaultMaxUses: parsePositiveInt(
      read('INVITE_DEFAULT_MAX_USES', env),
      PROVISIONAL_INVITE_DEFAULT_MAX_USES,
    ),
    roomCreationMaxAttempts: parsePositiveInt(
      read('ROOM_CREATION_RATE_LIMIT_MAX', env),
      PROVISIONAL_ROOM_CREATION_MAX_ATTEMPTS,
    ),
    roomCreationWindowMs: parsePositiveInt(
      read('ROOM_CREATION_RATE_LIMIT_WINDOW_MS', env),
      PROVISIONAL_ROOM_CREATION_WINDOW_MS,
    ),
    joinMaxFailures: parsePositiveInt(
      read('JOIN_RATE_LIMIT_MAX_FAILURES', env),
      JOIN_RATE_LIMIT_MAX_FAILURES,
    ),
    joinWindowMs: parsePositiveInt(
      read('JOIN_RATE_LIMIT_WINDOW_MS', env),
      JOIN_RATE_LIMIT_WINDOW_MS,
    ),
    livekitTokenTtlSeconds: parsePositiveInt(
      read('LIVEKIT_TOKEN_TTL_SECONDS', env),
      DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
    ),
    minLivekitTokenTtlSeconds: MIN_LIVEKIT_TOKEN_TTL_SECONDS,
    ownerSessionSecret: read('OWNER_SESSION_SECRET', env),
    appBaseUrl: read('APP_BASE_URL', env).replace(/\/$/, ''),
    maxParticipants: MAX_PARTICIPANTS,
    minAccessCodeLength: MIN_ACCESS_CODE_LENGTH,
    maxAccessCodeLength: MAX_ACCESS_CODE_LENGTH,
    maxRoomTitleLength: MAX_ROOM_TITLE_LENGTH,
    // Flags documenting provisional defaults (not Product Owner approvals).
    provisional: Object.freeze({
      d02CreationMode: true,
      d03DefaultExpiry: !read('ROOM_DEFAULT_EXPIRY_MINUTES', env),
      d04InviteMaxUses: !read('INVITE_DEFAULT_MAX_USES', env),
      d06OwnerApproval: true,
    }),
  };
}
