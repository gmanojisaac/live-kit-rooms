/**
 * Server-side room lookup abstraction.
 */

import { isValidRoomSlug } from './slug.js';
import { resolveRoomStatus, toPublicRoom } from './status.js';
import { createRoomRepository } from './repository.js';

/**
 * @returns {Promise<{ ok: true, room: object, publicRoom: object } | { ok: false, reason: string, httpStatus: number }>}
 */
export async function getRoomBySlug(slug, {
  repository,
  now = Date.now,
  includeSensitive = false,
} = {}) {
  if (!isValidRoomSlug(slug)) {
    return { ok: false, reason: 'INVALID_SLUG', httpStatus: 404 };
  }

  const repo = repository || createRoomRepository();
  const room = await repo.getRoomBySlug(slug);
  if (!room) {
    return { ok: false, reason: 'ROOM_NOT_FOUND', httpStatus: 404 };
  }

  const status = resolveRoomStatus(room, { now });
  const publicRoom = toPublicRoom({ ...room, status }, { now });

  if (!includeSensitive) {
    return { ok: true, room: publicRoom, publicRoom, status };
  }

  // Sensitive path for server-only callers (never serialize to clients).
  return {
    ok: true,
    room,
    publicRoom,
    status,
  };
}
