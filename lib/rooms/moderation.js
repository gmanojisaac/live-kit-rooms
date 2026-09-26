/**

 * Owner moderation orchestration (AUTH-05).

 * Lock / unlock prompt, remove participant, revoke invite, end room.

 */



import { assertServerOnly } from '../security/server-only.js';

import { createLiveKitRoomService } from '../livekit/rooms.js';

import { createRoomRepository } from './repository.js';

import { ROOM_STATUS } from './policy.js';

import { resolveRoomStatus } from './status.js';

import { ensureRoomNotStaleActive } from './owner-auth.js';

import { AUDIT_EVENT } from './audit.js';



export class ModerationError extends Error {

  constructor(message, { httpStatus = 400, code = 'BAD_REQUEST' } = {}) {

    super(message);

    this.name = 'ModerationError';

    this.httpStatus = httpStatus;

    this.code = code;

  }

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



async function writeAudit(repository, row) {

  try {

    return await repository.insertAuditEvent(row);

  } catch {

    return null;

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

function parseParticipantMetadata(metadata) {

  if (typeof metadata !== 'string' || !metadata) return {};

  try {

    const parsed = JSON.parse(metadata);

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};

  } catch {

    return {};

  }

}



/**

 * Lock or unlock prompt editing for a room.

 */

export async function setPromptLock({

  room,

  ownerId,

  locked,

  repository,

  now = Date.now,

}) {

  assertServerOnly();

  if (typeof locked !== 'boolean') {

    throw new ModerationError('locked must be a boolean.', {

      httpStatus: 422,

      code: 'INVALID_PAYLOAD',

    });

  }



  const status = await ensureRoomNotStaleActive(room, repository, { now });

  assertActiveForOwnerAction(status);



  const doc = await repository.setPromptLocked(room.id, locked);

  await writeAudit(repository, {

    room_id: room.id,

    event_type: locked ? AUDIT_EVENT.PROMPT_LOCKED : AUDIT_EVENT.PROMPT_UNLOCKED,

    actor_id: ownerId,

    metadata_minimal: { slug: room.slug, locked },

  });



  return {

    locked: Boolean(doc?.is_locked),

    roomStatus: status,

  };

}

/**

 * Promote a connected participant to app admin.

 */

export async function grantRoomAdmin({

  room,

  ownerId,

  actorIdentity = null,

  participantIdentity,

  repository,

  livekitRooms,

  livekitCredentials,

  now = Date.now,

}) {

  assertServerOnly();

  const identity = normalizeParticipantIdentity(participantIdentity);

  const status = await ensureRoomNotStaleActive(room, repository, { now });

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

  if (typeof roomsApi.updateParticipantMetadata !== 'function') {

    throw new ModerationError('LiveKit participant metadata updates are not configured.', {

      httpStatus: 503,

      code: 'LIVEKIT_UNCONFIGURED',

    });

  }

  const nextMetadata = {

    ...parseParticipantMetadata(target.metadata),

    role: 'admin',

  };

  let updated = target;

  try {

    updated = await roomsApi.updateParticipantMetadata(

      room.slug,

      identity,

      JSON.stringify(nextMetadata),

    );

  } catch {

    throw new ModerationError('Could not make participant an admin via LiveKit.', {

      httpStatus: 502,

      code: 'LIVEKIT_ADMIN_GRANT_FAILED',

    });

  }

  await writeAudit(repository, {

    room_id: room.id,

    event_type: AUDIT_EVENT.PARTICIPANT_ADMIN_GRANTED,

    actor_id: actorIdentity || ownerId,

    metadata_minimal: {

      slug: room.slug,

      participantIdentity: identity,

    },

  });

  return {

    granted: true,

    participantIdentity: identity,

    participant: {

      identity: updated?.identity || identity,

      metadata: updated?.metadata || JSON.stringify(nextMetadata),

    },

    roomStatus: status,

  };

}



/**

 * Remove a participant by LiveKit identity (not display name).

 */

export async function removeRoomParticipant({

  room,

  ownerId,

  participantIdentity,

  repository,

  livekitRooms,

  livekitCredentials,

  now = Date.now,

}) {

  assertServerOnly();



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



  const status = await ensureRoomNotStaleActive(room, repository, { now });

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



  try {

    await roomsApi.removeParticipant(room.slug, identity, { now });

  } catch (error) {

    const statusCode = error?.status ?? error?.code;

    if (statusCode === 404 || statusCode === 'not_found') {

      throw new ModerationError('Participant not found in this room.', {

        httpStatus: 404,

        code: 'PARTICIPANT_NOT_FOUND',

      });

    }

    throw new ModerationError('Could not remove participant via LiveKit.', {

      httpStatus: 502,

      code: 'LIVEKIT_REMOVE_FAILED',

    });

  }



  await writeAudit(repository, {

    room_id: room.id,

    event_type: AUDIT_EVENT.PARTICIPANT_REMOVED,

    actor_id: ownerId,

    metadata_minimal: {

      slug: room.slug,

      participantIdentity: identity,

    },

  });



  return {

    removed: true,

    participantIdentity: identity,

    roomStatus: status,

  };

}



/**

 * Revoke invitation(s). Prefer inviteId when provided; otherwise revoke the

 * active (unrevoked) invitation(s) for the room.

 */

export async function revokeRoomInvitation({

  room,

  ownerId,

  inviteId = null,

  repository,

  now = Date.now,

}) {

  assertServerOnly();



  const status = await ensureRoomNotStaleActive(room, repository, { now });

  const invites = await repository.listInvitesForRoom(room.id);

  const activeInvites = invites.filter((i) => !i.revoked_at);



  // Expired/ended rooms are not active for owner actions; allow idempotent

  // "already revoked" responses when nothing remains to revoke.

  if (status === ROOM_STATUS.EXPIRED || status === ROOM_STATUS.ENDED) {

    if (activeInvites.length === 0 && !inviteId) {

      return {

        revoked: false,

        alreadyRevoked: true,

        invitations: invites.map((i) => ({

          id: i.id,

          revokedAt: i.revoked_at,

          usedCount: i.used_count,

          maxUses: i.max_uses,

        })),

        roomStatus: status,

      };

    }

    assertActiveForOwnerAction(status);

  }



  const revokedAt = new Date(now()).toISOString();

  let revoked = [];



  if (inviteId) {

    if (typeof inviteId !== 'string' || !inviteId.trim()) {

      throw new ModerationError('Invalid invite id.', {

        httpStatus: 422,

        code: 'INVALID_INVITE',

      });

    }

    const invite = await repository.getInviteById(inviteId.trim());

    if (!invite || invite.room_id !== room.id) {

      throw new ModerationError('Invitation not found for this room.', {

        httpStatus: 404,

        code: 'INVITE_NOT_FOUND',

      });

    }

    if (invite.revoked_at) {

      return {

        revoked: false,

        alreadyRevoked: true,

        invitations: [{ id: invite.id, revokedAt: invite.revoked_at }],

        roomStatus: status,

      };

    }

    const updated = await repository.revokeInviteById(invite.id, { revokedAt });

    if (updated) revoked.push({ id: updated.id, revokedAt: updated.revoked_at });

  } else if (activeInvites.length === 0) {

    return {

      revoked: false,

      alreadyRevoked: true,

      invitations: invites.map((i) => ({

        id: i.id,

        revokedAt: i.revoked_at,

        usedCount: i.used_count,

        maxUses: i.max_uses,

      })),

      roomStatus: status,

    };

  } else {

    for (const invite of activeInvites) {

      const updated = await repository.revokeInviteById(invite.id, { revokedAt });

      if (updated) revoked.push({ id: updated.id, revokedAt: updated.revoked_at });

    }

  }



  await writeAudit(repository, {

    room_id: room.id,

    event_type: AUDIT_EVENT.INVITATION_REVOKED,

    actor_id: ownerId,

    metadata_minimal: {

      slug: room.slug,

      inviteIds: revoked.map((r) => r.id),

      count: revoked.length,

    },

  });



  return {

    revoked: true,

    alreadyRevoked: false,

    invitations: revoked,

    roomStatus: status,

  };

}



/**

 * End room: status → ended, revoke invites, delete LiveKit room, prompt read-only.

 * Idempotent when already ended.

 */

export async function endRoom({

  room,

  ownerId,

  repository,

  livekitRooms,

  livekitCredentials,

  now = Date.now,

}) {

  assertServerOnly();



  const resolved = resolveRoomStatus(room, { now });

  if (resolved === ROOM_STATUS.EXPIRED && room.status === ROOM_STATUS.ACTIVE) {

    await ensureRoomNotStaleActive(room, repository, { now });

  }



  const current = await repository.getRoomById(room.id);

  if (!current) {

    throw new ModerationError('Room not found.', {

      httpStatus: 404,

      code: 'ROOM_NOT_FOUND',

    });

  }



  if (current.status === ROOM_STATUS.EXPIRED) {

    throw new ModerationError('This room has already expired.', {

      httpStatus: 410,

      code: 'ROOM_EXPIRED',

    });

  }



  const alreadyEnded = current.status === ROOM_STATUS.ENDED;

  if (!alreadyEnded) {

    await repository.markRoomEnded(room.id);

  }



  await repository.revokeActiveInvitesForRoom(room.id, {

    revokedAt: new Date(now()).toISOString(),

  });



  try {

    await repository.ensurePromptDocument(room.id);

    await repository.setPromptLocked(room.id, true);

  } catch {

    // best-effort; ended status still gates writes

  }



  const roomsApi = createRoomsApi(livekitRooms, livekitCredentials);

  try {

    await roomsApi.deleteRoom(room.slug);

  } catch {

    if (!alreadyEnded) {

      throw new ModerationError('Room ended in database, but LiveKit close failed.', {

        httpStatus: 502,

        code: 'LIVEKIT_END_FAILED',

      });

    }

  }



  if (!alreadyEnded) {

    await writeAudit(repository, {

      room_id: room.id,

      event_type: AUDIT_EVENT.ROOM_ENDED,

      actor_id: ownerId,

      metadata_minimal: { slug: room.slug },

    });

  }



  return {

    ended: true,

    alreadyEnded,

    roomStatus: ROOM_STATUS.ENDED,

  };

}



/**

 * List LiveKit participants for owner UI (safe projection).

 */

export async function listRoomParticipants({

  room,

  livekitRooms,

  livekitCredentials,

  now = Date.now,

  repository,

}) {

  assertServerOnly();

  const status = await ensureRoomNotStaleActive(room, repository, { now });

  if (status !== ROOM_STATUS.ACTIVE) {

    return { participants: [], roomStatus: status };

  }



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



  return {

    roomStatus: status,

    participants: (participants || []).map((p) => ({

      identity: p.identity,

      name: p.name || null,

      state: p.state ?? null,

    })),

  };

}



export { createRoomRepository };
