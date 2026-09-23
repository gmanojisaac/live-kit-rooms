/**
 * Single-coordinator transfer: current owner hands privilege to a LiveKit participant.
 * Assignee claims a short-lived token (delivered in-meeting) to receive the owner session.
 */

import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { assertServerOnly } from '../security/server-only.js';
import { createOwnerSession, OWNER_SESSION_COOKIE, OWNER_SESSION_TTL_MS } from '../security/owner-session.js';
import { createLiveKitRoomService } from '../livekit/rooms.js';
import { createRoomRepository } from './repository.js';
import { COORDINATOR_TRANSFER_TTL_MS, ROOM_STATUS } from './policy.js';
import { ensureRoomNotStaleActive } from './owner-auth.js';
import { AUDIT_EVENT } from './audit.js';
import { ModerationError } from './moderation.js';

const CLAIM_TOKEN_BYTES = 32;

function createRoomsApi(livekitRooms, livekitCredentials) {
  if (livekitRooms) return livekitRooms;
  if (!livekitCredentials?.url || !livekitCredentials?.apiKey || !livekitCredentials?.apiSecret) {
    throw new ModerationError('LiveKit is not configured.', {
      httpStatus: 503,
      code: 'LIVEKIT_UNCONFIGURED',
    });
  }
  return createLiveKitRoomService({
    url: livekitCredentials.url,
    apiKey: livekitCredentials.apiKey,
    apiSecret: livekitCredentials.apiSecret,
  });
}

function assertActiveForOwnerAction(status) {
  if (status === ROOM_STATUS.EXPIRED) {
    throw new ModerationError('This room has expired.', {
      httpStatus: 410,
      code: 'ROOM_EXPIRED',
    });
  }
  if (status === ROOM_STATUS.ENDED) {
    throw new ModerationError('This room has ended.', {
      httpStatus: 410,
      code: 'ROOM_ENDED',
    });
  }
}

function normalizeParticipantIdentity(participantIdentity) {
  if (typeof participantIdentity !== 'string' || !participantIdentity.trim()) {
    throw new ModerationError('participantIdentity is required.', {
      httpStatus: 422,
      code: 'INVALID_PARTICIPANT',
    });
  }
  const identity = participantIdentity.trim();
  if (identity.length > 128 || !/^[A-Za-z0-9._:@-]+$/.test(identity)) {
    throw new ModerationError('Invalid participant identity.', {
      httpStatus: 422,
      code: 'INVALID_PARTICIPANT',
    });
  }
  return identity;
}

function hashClaimToken(rawToken) {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function mintClaimToken() {
  const claimToken = randomBytes(CLAIM_TOKEN_BYTES).toString('base64url');
  return {
    claimToken,
    claimTokenHash: hashClaimToken(claimToken),
  };
}

async function writeAudit(repository, row) {
  try {
    return await repository.insertAuditEvent(row);
  } catch {
    return null;
  }
}

/**
 * Initiate transfer to a connected LiveKit participant. Does not change owner_id yet.
 *
 * @returns {{ claimToken: string, expiresAt: string, targetIdentity: string, newOwnerId: string }}
 */
export async function transferCoordinator({
  room,
  ownerId,
  participantIdentity,
  repository,
  livekitRooms,
  livekitCredentials,
  now = Date.now,
  ttlMs = COORDINATOR_TRANSFER_TTL_MS,
}) {
  assertServerOnly();

  const identity = normalizeParticipantIdentity(participantIdentity);
  const repo = repository || createRoomRepository();
  const status = await ensureRoomNotStaleActive(room, repo, { now, actorId: ownerId });
  assertActiveForOwnerAction(status);

  const roomsApi = createRoomsApi(livekitRooms, livekitCredentials);

  let participants;
  try {
    participants = await roomsApi.listParticipants(room.slug);
  } catch {
    throw new ModerationError('Could not reach LiveKit to list participants.', {
      httpStatus: 502,
      code: 'LIVEKIT_UNAVAILABLE',
    });
  }

  const target = (participants || []).find((p) => p?.identity === identity);
  if (!target) {
    throw new ModerationError('Participant not found in this room.', {
      httpStatus: 404,
      code: 'PARTICIPANT_NOT_FOUND',
    });
  }

  const newOwnerId = randomUUID();
  const { claimToken, claimTokenHash } = mintClaimToken();
  const expiresAtMs = now() + ttlMs;
  const expiresAt = new Date(expiresAtMs).toISOString();

  await repo.cancelPendingCoordinatorTransfers(room.id);
  await repo.insertCoordinatorTransfer({
    room_id: room.id,
    from_owner_id: ownerId,
    to_participant_identity: identity,
    new_owner_id: newOwnerId,
    claim_token_hash: claimTokenHash,
    expires_at: expiresAt,
  });

  await writeAudit(repo, {
    room_id: room.id,
    event_type: AUDIT_EVENT.COORDINATOR_TRANSFER_INITIATED,
    actor_id: ownerId,
    metadata_minimal: {
      to_participant_identity: identity,
      expires_at: expiresAt,
    },
  });

  return {
    claimToken,
    expiresAt,
    targetIdentity: identity,
    newOwnerId,
  };
}

/**
 * Assignee claims pending transfer; updates rooms.owner_id and returns a new owner session.
 *
 * @returns {{
 *   ownerId: string,
 *   sessionCookie: { name: string, value: string, maxAgeSeconds: number },
 *   roomStatus: string,
 * }}
 */
export async function claimCoordinator({
  roomSlug,
  claimToken,
  participantIdentity,
  repository,
  policy,
  now = Date.now,
}) {
  assertServerOnly();

  if (typeof claimToken !== 'string' || !claimToken.trim()) {
    throw new ModerationError('claimToken is required.', {
      httpStatus: 422,
      code: 'INVALID_CLAIM_TOKEN',
    });
  }

  const identity = normalizeParticipantIdentity(participantIdentity);
  const repo = repository || createRoomRepository();

  if (!policy?.ownerSessionSecret || policy.ownerSessionSecret.length < 32) {
    throw new ModerationError('Owner session is not configured.', {
      httpStatus: 503,
      code: 'OWNER_SESSION_UNCONFIGURED',
    });
  }

  const room = await repo.getRoomBySlug(roomSlug);
  if (!room) {
    throw new ModerationError('Room not found.', {
      httpStatus: 404,
      code: 'ROOM_NOT_FOUND',
    });
  }

  const status = await ensureRoomNotStaleActive(room, repo, { now, actorId: identity });
  assertActiveForOwnerAction(status);

  const claimTokenHash = hashClaimToken(claimToken.trim());
  const transfer = await repo.getCoordinatorTransferByClaimHash(claimTokenHash);

  if (
    !transfer
    || transfer.room_id !== room.id
    || transfer.cancelled_at
    || transfer.claimed_at
  ) {
    throw new ModerationError('Transfer is invalid or already used.', {
      httpStatus: 410,
      code: 'TRANSFER_INVALID',
    });
  }

  const expiresMs = Date.parse(transfer.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= now()) {
    throw new ModerationError('Transfer has expired.', {
      httpStatus: 410,
      code: 'TRANSFER_EXPIRED',
    });
  }

  if (transfer.to_participant_identity !== identity) {
    throw new ModerationError('You are not the intended assignee for this transfer.', {
      httpStatus: 403,
      code: 'TRANSFER_IDENTITY_MISMATCH',
    });
  }

  // Only the current owner’s pending transfer may complete (prevents stale claims after re-transfer).
  if (room.owner_id !== transfer.from_owner_id) {
    throw new ModerationError('Transfer is no longer valid for this room.', {
      httpStatus: 410,
      code: 'TRANSFER_STALE',
    });
  }

  const claimed = await repo.markCoordinatorTransferClaimed(transfer.id, {
    claimedAt: new Date(now()).toISOString(),
  });
  if (!claimed) {
    throw new ModerationError('Transfer is invalid or already used.', {
      httpStatus: 410,
      code: 'TRANSFER_INVALID',
    });
  }

  const updated = await repo.updateRoomOwnerId(room.id, transfer.new_owner_id);
  if (!updated) {
    throw new ModerationError('Unable to update room coordinator.', {
      httpStatus: 500,
      code: 'TRANSFER_UPDATE_FAILED',
    });
  }

  const session = createOwnerSession(policy.ownerSessionSecret, {
    ownerId: transfer.new_owner_id,
    now,
  });

  await writeAudit(repo, {
    room_id: room.id,
    event_type: AUDIT_EVENT.COORDINATOR_TRANSFER_CLAIMED,
    actor_id: identity,
    metadata_minimal: {
      from_owner_id: transfer.from_owner_id,
      to_participant_identity: identity,
    },
  });

  return {
    ownerId: transfer.new_owner_id,
    roomStatus: status,
    sessionCookie: {
      name: OWNER_SESSION_COOKIE,
      value: session.token,
      maxAgeSeconds: Math.floor(OWNER_SESSION_TTL_MS / 1000),
    },
  };
}

export { hashClaimToken, mintClaimToken };
