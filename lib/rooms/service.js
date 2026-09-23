/**
 * Room creation orchestration (AUTH-01 / AUTH-02 foundation).
 */

import { timingSafeEqual } from 'node:crypto';
import { hashAccessCode, validateAccessCodeFormat } from '../security/access-code.js';
import { generateInviteToken } from '../security/invite-token.js';
import {
  createOwnerSession,
  verifyOwnerSession,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_TTL_MS,
} from '../security/owner-session.js';
import { getRoomPolicy, ROOM_STATUS, MAX_PARTICIPANTS } from './policy.js';
import { generateRoomSlug } from './slug.js';
import { toPublicRoom } from './status.js';
import { createRoomRepository } from './repository.js';

export class RoomCreationError extends Error {
  constructor(message, { httpStatus = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'RoomCreationError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function constantTimeMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function resolveExpiresAt({ expiresAtInput, policy, now }) {
  if (expiresAtInput != null && expiresAtInput !== '') {
    const ms = typeof expiresAtInput === 'number'
      ? expiresAtInput
      : Date.parse(expiresAtInput);
    if (!Number.isFinite(ms)) {
      throw new RoomCreationError('expiresAt must be a valid ISO timestamp.', {
        code: 'INVALID_EXPIRY',
      });
    }
    if (ms <= now()) {
      throw new RoomCreationError('expiresAt must be in the future.', {
        code: 'INVALID_EXPIRY',
      });
    }
    return new Date(ms).toISOString();
  }

  const ms = now() + policy.defaultExpiryMinutes * 60 * 1000;
  return new Date(ms).toISOString();
}

function buildInvitationUrl({ baseUrl, slug, rawToken }) {
  const url = new URL(`/room/${encodeURIComponent(slug)}`, `${baseUrl}/`);
  url.searchParams.set('invite', rawToken);
  return url.toString();
}

/**
 * Resolve owner identity for room creation.
 * Owner id is always server-derived — never from request body.owner_id.
 */
export function resolveOwnerForCreation({
  policy,
  existingSessionToken,
  creationSecretProvided,
  now = Date.now,
}) {
  if (!policy.ownerSessionSecret || policy.ownerSessionSecret.length < 32) {
    throw new RoomCreationError(
      'OWNER_SESSION_SECRET must be configured (min 32 characters).',
      { httpStatus: 503, code: 'OWNER_SESSION_UNCONFIGURED' },
    );
  }

  const existing = existingSessionToken
    ? verifyOwnerSession(existingSessionToken, policy.ownerSessionSecret, { now })
    : null;

  if (policy.creationMode === 'host_secret') {
    if (!policy.creationSecret) {
      throw new RoomCreationError(
        'ROOM_CREATION_SECRET must be configured for host_secret mode.',
        { httpStatus: 503, code: 'CREATION_SECRET_UNCONFIGURED' },
      );
    }
    const authorized = constantTimeMatch(creationSecretProvided || '', policy.creationSecret);
    if (!authorized && !existing) {
      throw new RoomCreationError('Room creation is not authorized.', {
        httpStatus: 401,
        code: 'CREATION_UNAUTHORIZED',
      });
    }
  }

  if (existing) {
    return {
      ownerId: existing.ownerId,
      session: null,
      reusedSession: true,
    };
  }

  const session = createOwnerSession(policy.ownerSessionSecret, { now });
  return {
    ownerId: session.ownerId,
    session,
    reusedSession: false,
  };
}

/**
 * Create a room + invitation. Returns public response fields only.
 */
export async function createRoom({
  title,
  accessCode,
  expiresAt,
  baseUrl,
  existingSessionToken,
  creationSecretProvided,
  repository,
  policy: policyOverride,
  env = process.env,
  now = Date.now,
}) {
  const policy = policyOverride || getRoomPolicy(env);
  const repo = repository || createRoomRepository({ env });

  if (typeof title !== 'string' || !title.trim()) {
    throw new RoomCreationError('Title is required.');
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle.length > policy.maxRoomTitleLength) {
    throw new RoomCreationError(`Title must be at most ${policy.maxRoomTitleLength} characters.`);
  }

  const codeFormat = validateAccessCodeFormat(accessCode, {
    minLength: policy.minAccessCodeLength,
    maxLength: policy.maxAccessCodeLength,
  });
  if (!codeFormat.ok) {
    throw new RoomCreationError(codeFormat.error, { code: 'INVALID_ACCESS_CODE' });
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new RoomCreationError('Unable to determine application base URL.', {
      httpStatus: 500,
      code: 'BASE_URL_MISSING',
    });
  }

  const owner = resolveOwnerForCreation({
    policy,
    existingSessionToken,
    creationSecretProvided,
    now,
  });

  const expiresAtIso = resolveExpiresAt({ expiresAtInput: expiresAt, policy, now });
  const codeHash = await hashAccessCode(accessCode);
  const { rawToken, tokenHash } = generateInviteToken();

  let room;
  let slug;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    slug = generateRoomSlug();
    try {
      room = await repo.insertRoom({
        slug,
        title: trimmedTitle,
        owner_id: owner.ownerId,
        code_hash: codeHash,
        status: ROOM_STATUS.ACTIVE,
        max_participants: MAX_PARTICIPANTS,
        expires_at: expiresAtIso,
      });
      break;
    } catch (error) {
      if (error?.code === '23505' || /duplicate/i.test(error?.message || '')) {
        continue;
      }
      throw error;
    }
  }
  if (!room) {
    throw new RoomCreationError('Unable to allocate a unique room slug.', {
      httpStatus: 500,
      code: 'SLUG_ALLOCATION_FAILED',
    });
  }

  const invite = await repo.insertInvite({
    room_id: room.id,
    token_hash: tokenHash,
    expires_at: expiresAtIso,
    max_uses: policy.inviteDefaultMaxUses,
    used_count: 0,
    revoked_at: null,
  });

  try {
    await repo.insertAuditEvent({
      room_id: room.id,
      event_type: 'room_created',
      actor_id: owner.ownerId,
      metadata_minimal: {
        roomSlug: room.slug,
        maxParticipants: MAX_PARTICIPANTS,
      },
    });
    await repo.insertAuditEvent({
      room_id: room.id,
      event_type: 'invite_created',
      actor_id: owner.ownerId,
      metadata_minimal: {
        roomSlug: room.slug,
        maxUses: invite.max_uses,
      },
    });
  } catch {
    // Audit failure must not roll back room creation; log sinks handle ops alerts later.
  }

  const invitationUrl = buildInvitationUrl({
    baseUrl: baseUrl.replace(/\/$/, ''),
    slug: room.slug,
    rawToken,
  });

  return {
    room: toPublicRoom(room, { now }),
    invitationUrl,
    owner: { id: owner.ownerId },
    invite: {
      id: invite.id,
      maxUses: invite.max_uses,
      usedCount: invite.used_count,
      expiresAt: invite.expires_at,
    },
    sessionCookie: owner.session
      ? {
        name: OWNER_SESSION_COOKIE,
        value: owner.session.token,
        maxAgeSeconds: Math.floor(OWNER_SESSION_TTL_MS / 1000),
      }
      : null,
    // Internal-only fields for tests — strip before HTTP response.
    _test: {
      codeHash: room.code_hash,
      tokenHash: invite.token_hash,
      rawToken,
    },
  };
}

export function stripInternalCreateResult(result) {
  const { _test, sessionCookie, ...publicResult } = result;
  return { publicResult, sessionCookie, _test };
}
