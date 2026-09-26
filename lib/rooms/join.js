/**
 * Participant join orchestration (AUTH-03 + AUTH-04).
 * Validates invitation/access code/room state/capacity, mints LiveKit JWT,
 * then atomically consumes one invitation use.
 */

import { randomUUID } from 'node:crypto';
import { isValidRoomSlug } from './slug.js';
import { normalizeDisplayName } from './display-name.js';
import {
  validateRoomAccess,
  AccessRejection,
} from './access-validation.js';
import { resolveRoomStatus } from './status.js';
import { MAX_PARTICIPANTS, ROOM_STATUS, MIN_ACCESS_CODE_LENGTH } from './policy.js';
import { createRoomRepository } from './repository.js';
import { AUDIT_EVENT } from './audit.js';
import {
  computeTokenExpiry,
  createParticipantAccessToken,
} from '../livekit/token.js';
import { createLiveKitRoomService } from '../livekit/rooms.js';
import { verifyOwnerSession } from '../security/owner-session.js';
import {
  createModeratorActionToken,
  verifyCreatorJoinToken,
} from '../security/room-role-token.js';

export class RoomJoinError extends Error {
  constructor(message, { httpStatus = 400, code = 'BAD_REQUEST', retryAfterSeconds } = {}) {
    super(message);
    this.name = 'RoomJoinError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Plausible invite-token format (base64url CSPRNG material). */
export function isPlausibleInviteToken(rawToken) {
  return typeof rawToken === 'string'
    && rawToken.length >= 16
    && rawToken.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(rawToken);
}

const AUTH_FAILURE_REASONS = new Set([
  AccessRejection.INVITE_INVALID,
  AccessRejection.INVITE_REVOKED,
  AccessRejection.INVITE_EXPIRED,
  AccessRejection.INVITE_ROOM_MISMATCH,
  AccessRejection.ACCESS_CODE_INVALID,
]);

export function isAuthFailureReason(reason) {
  return AUTH_FAILURE_REASONS.has(reason);
}

export const PARTICIPANT_ROLES = Object.freeze({
  ADMIN: 'admin',
  PARTICIPANT: 'participant',
});

function mapAccessRejection(reason, httpStatus) {
  switch (reason) {
    case AccessRejection.ROOM_NOT_FOUND:
      return new RoomJoinError('Room not found.', {
        httpStatus: 404,
        code: reason,
      });
    case AccessRejection.ROOM_ENDED:
      return new RoomJoinError('This room has ended.', {
        httpStatus: 410,
        code: reason,
      });
    case AccessRejection.ROOM_EXPIRED:
      return new RoomJoinError('This room has expired.', {
        httpStatus: 410,
        code: reason,
      });
    case AccessRejection.CAPACITY_FULL:
      return new RoomJoinError('This room is full.', {
        httpStatus: 409,
        code: reason,
      });
    case AccessRejection.INVITE_EXHAUSTED:
      return new RoomJoinError('This invitation is no longer available.', {
        httpStatus: 409,
        code: reason,
      });
    default:
      return new RoomJoinError('Invalid invitation or access code.', {
        httpStatus: httpStatus || 403,
        code: reason || AccessRejection.INVITE_INVALID,
      });
  }
}

function resolveParticipantRole({
  room,
  policy,
  ownerSessionToken,
  ownerJoinToken,
  now = Date.now,
}) {
  if (!room?.owner_id || !policy?.ownerSessionSecret || !ownerSessionToken || !ownerJoinToken) {
    return PARTICIPANT_ROLES.PARTICIPANT;
  }

  const session = verifyOwnerSession(ownerSessionToken, policy.ownerSessionSecret, { now });
  if (!session?.ownerId || session.ownerId !== room.owner_id) {
    return PARTICIPANT_ROLES.PARTICIPANT;
  }

  const creatorJoin = verifyCreatorJoinToken(ownerJoinToken, {
    secret: policy.ownerSessionSecret,
    ownerId: room.owner_id,
    roomId: room.id,
    slug: room.slug,
    now,
  });

  return creatorJoin
    ? PARTICIPANT_ROLES.ADMIN
    : PARTICIPANT_ROLES.PARTICIPANT;
}

/**
 * Join a room as a participant and receive a short-lived LiveKit JWT.
 *
 * @returns {Promise<{
 *   token: string,
 *   livekitUrl: string,
 *   room: { slug: string, title: string, expiresAt: string, maxParticipants: number },
 *   participant: { identity: string, displayName: string },
 *   tokenExpiresAt: string,
 * }>}
 */
export async function joinRoomAsParticipant({
  slug,
  inviteToken,
  displayName: displayNameInput,
  accessCode,
  repository,
  livekitRooms,
  livekitCredentials,
  policy,
  now = Date.now,
  ownerSessionToken = null,
  ownerJoinToken = null,
  // Client-supplied identity / room name must never control joins.
  identity: _ignoredIdentity,
  roomName: _ignoredRoomName,
} = {}) {
  if (!isValidRoomSlug(slug)) {
    throw new RoomJoinError('Room not found.', {
      httpStatus: 404,
      code: AccessRejection.ROOM_NOT_FOUND,
    });
  }

  const nameCheck = normalizeDisplayName(displayNameInput);
  if (!nameCheck.ok) {
    throw new RoomJoinError('Enter a display name (1–40 characters).', {
      httpStatus: 400,
      code: 'INVALID_DISPLAY_NAME',
    });
  }

  if (inviteToken && !isPlausibleInviteToken(inviteToken)) {
    throw new RoomJoinError('Invalid invitation or access code.', {
      httpStatus: 403,
      code: AccessRejection.INVITE_INVALID,
    });
  }

  if (typeof accessCode === 'string' && accessCode.trim().length > 0 && accessCode.trim().length < MIN_ACCESS_CODE_LENGTH) {
    throw new RoomJoinError('Invalid invitation or access code.', {
      httpStatus: 403,
      code: AccessRejection.ACCESS_CODE_INVALID,
    });
  }


  const repo = repository || createRoomRepository();
  const maxParticipants = policy?.maxParticipants ?? MAX_PARTICIPANTS;
  const configuredTtl = policy?.livekitTokenTtlSeconds;
  const minTtl = policy?.minLivekitTokenTtlSeconds;

  if (!livekitCredentials?.apiKey || !livekitCredentials?.apiSecret || !livekitCredentials?.url) {
    throw new RoomJoinError('LiveKit is not configured.', {
      httpStatus: 503,
      code: 'LIVEKIT_UNCONFIGURED',
    });
  }

  const roomsApi = livekitRooms || createLiveKitRoomService({
    url: livekitCredentials.url,
    apiKey: livekitCredentials.apiKey,
    apiSecret: livekitCredentials.apiSecret,
    maxParticipants,
  });

  let participantCount = 0;
  try {
    participantCount = await roomsApi.countParticipants(slug);
  } catch {
    throw new RoomJoinError(
      'Could not prepare the LiveKit room. Check the server credentials and connection, then try again.',
      { httpStatus: 502, code: 'LIVEKIT_UNAVAILABLE' },
    );
  }

  const access = await validateRoomAccess({
    repository: repo,
    slug,
    rawInviteToken: inviteToken,
    accessCode,
    participantCount,
    maxParticipants,
    now,
  });

  if (!access.ok) {
    if (
      access.reason === AccessRejection.ROOM_EXPIRED
      || access.reason === AccessRejection.ROOM_ENDED
    ) {
      const room = await repo.getRoomBySlug(slug);
      if (room && room.status === ROOM_STATUS.ACTIVE) {
        const resolved = resolveRoomStatus(room, { now });
        if (resolved === ROOM_STATUS.EXPIRED) {
          try {
            const marked = await repo.markRoomExpired(room.id);
            if (marked) {
              try {
                await repo.insertAuditEvent({
                  room_id: room.id,
                  event_type: AUDIT_EVENT.ROOM_EXPIRED,
                  actor_id: null,
                  metadata_minimal: { slug: room.slug },
                });
              } catch {
                // best-effort
              }
            }
          } catch {
            // Best-effort status sync; join still rejected.
          }
        }
      }
    }
    throw mapAccessRejection(access.reason, access.httpStatus);
  }

  const { room, invite } = access;

  let livekitRoom;
  try {
    livekitRoom = await roomsApi.ensureRoom(slug);
  } catch {
    throw new RoomJoinError(
      'Could not prepare the LiveKit room. Check the server credentials and connection, then try again.',
      { httpStatus: 502, code: 'LIVEKIT_UNAVAILABLE' },
    );
  }

  if (
    livekitRoom?.maxParticipants != null
    && Number(livekitRoom.maxParticipants) > 0
    && Number(livekitRoom.maxParticipants) !== maxParticipants
  ) {
    // Refuse to join a LiveKit room that was created without the six-person backstop.
    throw new RoomJoinError('This room is not configured for the required participant limit.', {
      httpStatus: 409,
      code: 'ROOM_LIMIT_MISMATCH',
    });
  }

  // Re-check capacity after ensureRoom (connected count may have changed).
  try {
    participantCount = await roomsApi.countParticipants(slug);
  } catch {
    throw new RoomJoinError(
      'Could not prepare the LiveKit room. Check the server credentials and connection, then try again.',
      { httpStatus: 502, code: 'LIVEKIT_UNAVAILABLE' },
    );
  }
  if (participantCount >= maxParticipants) {
    throw new RoomJoinError('This room is full.', {
      httpStatus: 409,
      code: AccessRejection.CAPACITY_FULL,
    });
  }

  const expiry = computeTokenExpiry({
    now,
    roomExpiresAt: room.expires_at,
    configuredTtlSeconds: configuredTtl,
    minTtlSeconds: minTtl,
  });
  if (!expiry.ok) {
    try {
      await repo.markRoomExpired(room.id);
    } catch {
      // ignore
    }
    throw new RoomJoinError('This room has expired.', {
      httpStatus: 410,
      code: AccessRejection.ROOM_EXPIRED,
    });
  }

  const identity = randomUUID();
  const role = resolveParticipantRole({
    room,
    policy,
    ownerSessionToken,
    ownerJoinToken,
    now,
  });
  const moderatorToken = role === PARTICIPANT_ROLES.ADMIN
    ? createModeratorActionToken({
      secret: policy.ownerSessionSecret,
      ownerId: room.owner_id,
      roomId: room.id,
      slug: room.slug,
      participantIdentity: identity,
      expiresAt: expiry.expiresAt.toISOString(),
      now,
    })
    : null;

  let token;
  try {
    token = await createParticipantAccessToken({
      apiKey: livekitCredentials.apiKey,
      apiSecret: livekitCredentials.apiSecret,
      identity,
      displayName: nameCheck.displayName,
      roomName: room.slug,
      expiresAt: expiry.expiresAt,
      maxParticipants,
      metadata: { role },
    });
  } catch {
    throw new RoomJoinError(
      'Could not prepare the LiveKit room. Check the server credentials and connection, then try again.',
      { httpStatus: 502, code: 'LIVEKIT_UNAVAILABLE' },
    );
  }

  // Consume only after auth + capacity + token mint succeed.
  const consumed = await repo.tryConsumeInvite(invite.id);
  if (!consumed) {
    throw new RoomJoinError('This invitation is no longer available.', {
      httpStatus: 409,
      code: AccessRejection.INVITE_EXHAUSTED,
    });
  }

  try {
    await repo.insertAuditEvent({
      room_id: room.id,
      event_type: 'participant_joined',
      actor_id: identity,
      metadata_minimal: {
        slug: room.slug,
        displayNameLength: nameCheck.displayName.length,
      },
    });
  } catch {
    // Audit is best-effort; admission already succeeded.
  }

  return {
    token,
    livekitUrl: livekitCredentials.url,
    room: {
      slug: room.slug,
      title: room.title,
      expiresAt: room.expires_at,
      maxParticipants: room.max_participants ?? maxParticipants,
    },
    participant: {
      identity,
      displayName: nameCheck.displayName,
      role,
      isAdmin: role === PARTICIPANT_ROLES.ADMIN,
    },
    moderatorToken,
    tokenExpiresAt: expiry.expiresAt.toISOString(),
  };
}
