/**

 * Server-side room-owner authorization (AUTH-05).

 * Owner identity comes only from the signed HTTP-only session cookie —

 * never from request body ownerId / owner_id, and never from slug alone.

 */



import { assertServerOnly } from '../security/server-only.js';

import { verifyOwnerSession } from '../security/owner-session.js';

import { getOwnerSessionToken } from '../http/request.js';

import { getRoomPolicy, ROOM_STATUS } from './policy.js';

import { createRoomRepository } from './repository.js';

import { isValidRoomSlug } from './slug.js';

import { resolveRoomStatus } from './status.js';

import { AUDIT_EVENT } from './audit.js';



export class OwnerAuthError extends Error {

  constructor(message, { httpStatus = 403, code = 'FORBIDDEN' } = {}) {

    super(message);

    this.name = 'OwnerAuthError';

    this.httpStatus = httpStatus;

    this.code = code;

  }

}



/**

 * @param {Request} request

 * @param {string} roomSlug

 * @param {{

 *   repository?: object,

 *   policy?: object,

 *   env?: NodeJS.ProcessEnv,

 *   now?: () => number,

 *   sessionToken?: string | null,

 * }} [options]

 * @returns {Promise<{ ownerId: string, room: object, status: string }>}

 */

export async function requireRoomOwner(request, roomSlug, options = {}) {

  assertServerOnly();



  if (!isValidRoomSlug(roomSlug)) {

    throw new OwnerAuthError('Room not found.', {

      httpStatus: 404,

      code: 'ROOM_NOT_FOUND',

    });

  }



  const env = options.env || process.env;

  const policy = options.policy || getRoomPolicy(env);

  const secret = policy.ownerSessionSecret;

  if (!secret || secret.length < 32) {

    throw new OwnerAuthError('Owner session is not configured.', {

      httpStatus: 503,

      code: 'OWNER_SESSION_UNCONFIGURED',

    });

  }



  const now = options.now || Date.now;

  const token = options.sessionToken !== undefined

    ? options.sessionToken

    : (request ? getOwnerSessionToken(request) : null);



  const session = typeof token === 'string' && token

    ? verifyOwnerSession(token, secret, { now })

    : null;



  if (!session?.ownerId) {

    throw new OwnerAuthError('Owner authentication required.', {

      httpStatus: 401,

      code: 'OWNER_UNAUTHORIZED',

    });

  }



  const repo = options.repository || createRoomRepository({ env });

  const room = await repo.getRoomBySlug(roomSlug);

  if (!room) {

    throw new OwnerAuthError('Room not found.', {

      httpStatus: 404,

      code: 'ROOM_NOT_FOUND',

    });

  }



  if (!room.owner_id || room.owner_id !== session.ownerId) {

    throw new OwnerAuthError('You are not the owner of this room.', {

      httpStatus: 403,

      code: 'OWNER_FORBIDDEN',

    });

  }



  const status = resolveRoomStatus(room, { now });

  return {

    ownerId: session.ownerId,

    room,

    status,

  };

}



/**

 * Safe owner context for public room responses — never leaks session material.

 */

export function resolveOwnerContext(request, room, { policy, now = Date.now } = {}) {

  if (!room?.owner_id || !policy?.ownerSessionSecret) {

    return { isOwner: false };

  }

  const token = request ? getOwnerSessionToken(request) : null;

  if (!token) return { isOwner: false };

  const session = verifyOwnerSession(token, policy.ownerSessionSecret, { now });

  if (!session?.ownerId || session.ownerId !== room.owner_id) {

    return { isOwner: false };

  }

  return { isOwner: true };

}



/**

 * Transition an active room to expired when server time has passed expires_at.

 * Idempotent; never reactivates ended rooms. Returns updated status.

 */

export async function ensureRoomNotStaleActive(room, repository, {

  now = Date.now,

  actorId = null,

} = {}) {

  if (!room) return ROOM_STATUS.ENDED;

  const status = resolveRoomStatus(room, { now });

  if (status !== ROOM_STATUS.EXPIRED) return status;

  if (room.status === ROOM_STATUS.ENDED) return ROOM_STATUS.ENDED;

  if (room.status === ROOM_STATUS.EXPIRED) return ROOM_STATUS.EXPIRED;



  const updated = await repository.markRoomExpired(room.id);

  if (updated) {

    try {

      await repository.insertAuditEvent({

        room_id: room.id,

        event_type: AUDIT_EVENT.ROOM_EXPIRED,

        actor_id: actorId,

        metadata_minimal: { slug: room.slug },

      });

    } catch {

      // best-effort

    }

  }

  return ROOM_STATUS.EXPIRED;

}

