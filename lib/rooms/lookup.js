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
  const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  if (!isValidRoomSlug(normalizedSlug)) {
    return { ok: false, reason: 'INVALID_SLUG', httpStatus: 404 };
  }

  const repo = repository || createRoomRepository();
  let room = await repo.getRoomBySlug(normalizedSlug);
  if (!room && normalizedSlug.length === 11 && !normalizedSlug.includes('-')) {
    const formatted = `${normalizedSlug.slice(0, 3)}-${normalizedSlug.slice(3, 7)}-${normalizedSlug.slice(7)}`;
    room = await repo.getRoomBySlug(formatted);
  }
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
