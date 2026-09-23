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

  if (invite.max_uses != null && invite.used_count >= invite.max_uses) {
    return { ok: false, reason: AccessRejection.INVITE_EXHAUSTED };
  }

  return { ok: true };
}

/**
 * Full foundation check: room slug + raw invite token + access code.
 * Does NOT increment used_count (call tryConsumeInvite only after success path is ready).
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

  if (typeof rawInviteToken !== 'string' || !rawInviteToken) {
    return { ok: false, reason: AccessRejection.INVITE_INVALID, httpStatus: 403 };
  }

  let tokenHash;
  try {
    tokenHash = hashInviteToken(rawInviteToken);
  } catch {
    return { ok: false, reason: AccessRejection.INVITE_INVALID, httpStatus: 403 };
  }

  const invite = await repository.getInviteByTokenHash(tokenHash);
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

  const codeOk = await verifyAccessCode(accessCode, room.code_hash);
  if (!codeOk) {
    return { ok: false, reason: AccessRejection.ACCESS_CODE_INVALID, httpStatus: 403 };
  }

  if (participantCount >= maxParticipants) {
    return { ok: false, reason: AccessRejection.CAPACITY_FULL, httpStatus: 409 };
  }

  return { ok: true, room, invite };
}
