/**
 * Reusable access validation for invite + access code + room state.
 * Join route will call these helpers; do not duplicate ad-hoc checks per route.
 */

import { hashInviteToken } from '../security/invite-token.js';
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
});

/**
 * Evaluate whether an invitation row is currently usable (without consuming).
 */
export function evaluateInvite(invite, { now = Date.now, roomExpiresAt = null } = {}) {
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

  // Invitation must not outlive the room.
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
 * Full foundation check: room slug + raw invite token + access code.
 * Does NOT increment used_count. Room capacity is based on connected participants,
 * not historical invite-use count.
 *
 * @returns {Promise<{ ok: true, room, invite } | { ok: false, reason: string, httpStatus: number }>}
 */
export async function validateRoomAccess({
  repository,
  slug,
  rawInviteToken,
  accessCode,
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

  return { ok: true, room, invite };
}
