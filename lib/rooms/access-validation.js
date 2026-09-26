/**
 * Reusable access validation for invite + access code + room state.
 * Join route will call these helpers; do not duplicate ad-hoc checks per route.
 */

import { hashInviteToken } from '../security/invite-token.js';
import { hashRejoinToken, isPlausibleRejoinToken } from '../security/rejoin-token.js';
import { verifyAccessCode } from '../security/access-code.js';
import { isRoomJoinable, resolveRoomStatus } from './status.js';
import { MAX_PARTICIPANTS } from './policy.js';

export const AccessRejection = Object.freeze({
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_ENDED: 'ROOM_ENDED',
  ROOM_EXPIRED: 'ROOM_EXPIRED',
  INVITE_INVALID: 'INVITE_INVALID',
  INVITE_REVOKED: 'INVITE_REVOKED',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_EXHAUSTED: 'INVITE_EXHAUSTED',
  INVITE_ROOM_MISMATCH: 'INVITE_ROOM_MISMATCH',
  ACCESS_CODE_INVALID: 'ACCESS_CODE_INVALID',
  CAPACITY_FULL: 'CAPACITY_FULL',
  REJOIN_INVALID: 'REJOIN_INVALID',
  REJOIN_REVOKED: 'REJOIN_REVOKED',
});

/**
 * Evaluate invitation usability without max_uses exhaustion.
 * Used when a valid rejoin grant may bypass used_count.
 */
export function evaluateInviteCredentials(invite, { now = Date.now, roomExpiresAt = null } = {}) {
  if (!invite) {
    return { ok: false, reason: AccessRejection.INVITE_INVALID };
  }
  if (invite.revoked_at) {
    return { ok: false, reason: AccessRejection.INVITE_REVOKED };
  }

  const inviteExpiry = invite.expires_at ? Date.parse(invite.expires_at) : null;
  if (Number.isFinite(inviteExpiry) && inviteExpiry <= now()) {
    return { ok: false, reason: AccessRejection.INVITE_EXPIRED };
  }

  if (roomExpiresAt) {
    const roomMs = typeof roomExpiresAt === 'number' ? roomExpiresAt : Date.parse(roomExpiresAt);
    if (Number.isFinite(roomMs) && roomMs <= now()) {
      return { ok: false, reason: AccessRejection.ROOM_EXPIRED };
    }
    if (Number.isFinite(inviteExpiry) && Number.isFinite(roomMs) && inviteExpiry > roomMs) {
      return { ok: false, reason: AccessRejection.INVITE_EXPIRED };
    }
  }

  return { ok: true };
}

/**
 * Evaluate whether an invitation row is currently usable (without consuming).
 */
export function evaluateInvite(invite, { now = Date.now, roomExpiresAt = null } = {}) {
  return evaluateInviteCredentials(invite, { now, roomExpiresAt });
}

/**
 * Full foundation check: room slug + raw invite token + access code.
 * Optional rejoinToken allows a previously admitted participant to bypass
 * invite used_count when the grant matches this room/invite and is not revoked.
 * Does NOT increment used_count. Room capacity is based on connected participants,
 * not historical invite-use count.
 *
 * @returns {Promise<{ ok: true, room, invite, rejoinGrant: object|null, isRejoin: boolean } | { ok: false, reason: string, httpStatus: number }>}
 */
export async function validateRoomAccess({
  repository,
  slug,
  rawInviteToken,
  accessCode,
  rejoinToken = null,
  participantCount = 0,
  maxParticipants = MAX_PARTICIPANTS,
  now = Date.now,
}) {
  const room = await repository.getRoomBySlug(slug);
  if (!room) {
    return { ok: false, reason: AccessRejection.ROOM_NOT_FOUND, httpStatus: 404 };
  }

  const status = resolveRoomStatus(room, { now });
  if (status === 'ended') {
    return { ok: false, reason: AccessRejection.ROOM_ENDED, httpStatus: 410 };
  }
  if (status === 'expired' || !isRoomJoinable(room, { now })) {
    return { ok: false, reason: AccessRejection.ROOM_EXPIRED, httpStatus: 410 };
  }

  let invite = null;
  if (typeof rawInviteToken === 'string' && rawInviteToken.trim()) {
    let tokenHash;
    try {
      tokenHash = hashInviteToken(rawInviteToken.trim());
    } catch {
      return { ok: false, reason: AccessRejection.INVITE_INVALID, httpStatus: 403 };
    }

    invite = await repository.getInviteByTokenHash(tokenHash);
    if (!invite) {
      return { ok: false, reason: AccessRejection.INVITE_INVALID, httpStatus: 403 };
    }
    if (invite.room_id !== room.id) {
      return { ok: false, reason: AccessRejection.INVITE_ROOM_MISMATCH, httpStatus: 403 };
    }

    const inviteCheck = evaluateInvite(invite, {
      now,
      roomExpiresAt: room.expires_at,
    });
    if (!inviteCheck.ok) {
      const httpStatus = inviteCheck.reason === AccessRejection.INVITE_EXHAUSTED ? 409 : 403;
      return { ok: false, reason: inviteCheck.reason, httpStatus };
    }
  } else {
    // Participant joining directly by room slug + access code without an invite token
    const invites = await repository.listInvitesForRoom(room.id);
    const validInvites = (invites || []).filter((inv) => {
      return evaluateInvite(inv, { now, roomExpiresAt: room.expires_at }).ok;
    });
    if (validInvites.length === 0) {
      return { ok: false, reason: AccessRejection.INVITE_EXHAUSTED, httpStatus: 409 };
    }
    invite = validInvites[0];
  }

  if (typeof accessCode === 'string' && accessCode.trim().length > 0) {
    const codeOk = await verifyAccessCode(accessCode.trim(), room.code_hash);
    if (!codeOk) {
      return { ok: false, reason: AccessRejection.ACCESS_CODE_INVALID, httpStatus: 403 };
    }
  }

  if (participantCount >= maxParticipants) {
    return { ok: false, reason: AccessRejection.CAPACITY_FULL, httpStatus: 409 };
  }

  let rejoinGrant = null;
  let softRejoinMiss = false;
  if (rejoinToken != null && rejoinToken !== '') {
    if (!isPlausibleRejoinToken(rejoinToken)) {
      softRejoinMiss = true;
    } else {
      let rejoinHash;
      try {
        rejoinHash = hashRejoinToken(rejoinToken);
      } catch {
        softRejoinMiss = true;
        rejoinHash = null;
      }
      if (rejoinHash) {
        const grant = typeof repository.getParticipantRejoinGrantByTokenHash === 'function'
          ? await repository.getParticipantRejoinGrantByTokenHash(rejoinHash)
          : null;
        if (!grant) {
          softRejoinMiss = true;
        } else if (grant.revoked_at) {
          return { ok: false, reason: AccessRejection.REJOIN_REVOKED, httpStatus: 403 };
        } else if (grant.room_id !== room.id || grant.invite_id !== invite.id) {
          return { ok: false, reason: AccessRejection.REJOIN_INVALID, httpStatus: 403 };
        } else {
          rejoinGrant = grant;
        }
      }
    }
  }

  if (rejoinGrant) {
    const credentials = evaluateInviteCredentials(invite, {
      now,
      roomExpiresAt: room.expires_at,
    });
    if (!credentials.ok) {
      const httpStatus = credentials.reason === AccessRejection.ROOM_EXPIRED ? 410 : 403;
      return { ok: false, reason: credentials.reason, httpStatus };
    }
    return { ok: true, room, invite, rejoinGrant, isRejoin: true };
  }

  const inviteCheck = evaluateInvite(invite, {
    now,
    roomExpiresAt: room.expires_at,
  });
  if (!inviteCheck.ok) {
    if (
      inviteCheck.reason === AccessRejection.INVITE_EXHAUSTED
      && softRejoinMiss
    ) {
      return { ok: false, reason: AccessRejection.REJOIN_INVALID, httpStatus: 403 };
    }
    const httpStatus = inviteCheck.reason === AccessRejection.INVITE_EXHAUSTED ? 409 : 403;
    return { ok: false, reason: inviteCheck.reason, httpStatus };
  }

  // Unknown/malformed rejoin token with remaining invite uses → first-time admission.
  return { ok: true, room, invite, rejoinGrant: null, isRejoin: false };
}
