/**
 * Server-side room status / expiry evaluation.
 * Never trust a client-supplied expired flag.
 */

import { ROOM_STATUS } from './policy.js';

/**
 * @param {{ status: string, expires_at?: string | Date | null }} room
 * @param {{ now?: () => number }} [options]
 * @returns {'active' | 'ended' | 'expired'}
 */
export function resolveRoomStatus(room, options = {}) {
  if (!room || typeof room !== 'object') return ROOM_STATUS.ENDED;
  if (room.status === ROOM_STATUS.ENDED) return ROOM_STATUS.ENDED;

  const now = options.now || Date.now;
  const expiresAt = room.expires_at ?? room.expiresAt;
  if (expiresAt) {
    const ms = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
    if (Number.isFinite(ms) && ms <= now()) {
      return ROOM_STATUS.EXPIRED;
    }
  }

  if (room.status === ROOM_STATUS.EXPIRED) return ROOM_STATUS.EXPIRED;
  if (room.status === ROOM_STATUS.ACTIVE) return ROOM_STATUS.ACTIVE;
  return ROOM_STATUS.ENDED;
}

export function isRoomJoinable(room, options = {}) {
  return resolveRoomStatus(room, options) === ROOM_STATUS.ACTIVE;
}

/**
 * Public-safe room projection — never includes hashes or secrets.
 */
export function toPublicRoom(room, options = {}) {
  if (!room) return null;
  const status = resolveRoomStatus(room, options);
  const promptLocked = Boolean(options.promptLocked)
    || status === ROOM_STATUS.ENDED
    || status === ROOM_STATUS.EXPIRED;
  return {
    id: room.id,
    slug: room.slug,
    title: room.title,
    status,
    roomStatus: status,
    maxParticipants: room.max_participants ?? room.maxParticipants,
    expiresAt: room.expires_at ?? room.expiresAt ?? null,
    createdAt: room.created_at ?? room.createdAt ?? null,
    promptLocked,
    isOwner: Boolean(options.isOwner),
    isCoordinator: Boolean(options.isOwner),
  };
}
