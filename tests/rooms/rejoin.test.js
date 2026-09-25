import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
} from '../../lib/rooms/service.js';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import {
  joinRoomAsParticipant,
  RoomJoinError,
} from '../../lib/rooms/join.js';
import {
  removeRoomParticipant,
  endRoom,
} from '../../lib/rooms/moderation.js';
import {
  MAX_PARTICIPANTS,
  PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
  PROVISIONAL_INVITE_DEFAULT_MAX_USES,
} from '../../lib/rooms/policy.js';
import {
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} from '../../lib/livekit/token.js';
import { hashRejoinToken } from '../../lib/security/rejoin-token.js';
import {
  clearRejoinToken,
  readRejoinToken,
  saveRejoinToken,
} from '../../lib/rooms/rejoin-storage.js';

const ACCESS_CODE = 'test-access-code-ok';
const SESSION_SECRET = 'test-owner-session-secret-32chars!!';
const LIVEKIT = {
  url: 'wss://example.livekit.cloud',
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret-value-for-jwt',
};

function testPolicy(overrides = {}) {
  return {
    creationMode: 'open',
    creationSecret: '',
    defaultExpiryMinutes: PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
    inviteDefaultMaxUses: PROVISIONAL_INVITE_DEFAULT_MAX_USES,
    roomCreationMaxAttempts: 10,
    roomCreationWindowMs: 15 * 60 * 1000,
    joinMaxFailures: 5,
    joinWindowMs: 15 * 60 * 1000,
    livekitTokenTtlSeconds: DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
    minLivekitTokenTtlSeconds: MIN_LIVEKIT_TOKEN_TTL_SECONDS,
    ownerSessionSecret: SESSION_SECRET,
    appBaseUrl: 'https://example.test',
    maxParticipants: MAX_PARTICIPANTS,
    minAccessCodeLength: 12,
    maxAccessCodeLength: 128,
    maxRoomTitleLength: 120,
    provisional: {},
    ...overrides,
  };
}

function createMockLiveKit({ participantCount = 0, maxParticipants = MAX_PARTICIPANTS } = {}) {
  let count = participantCount;
  const participants = new Map();
  return {
    maxParticipants,
    async ensureRoom(roomName) {
      return { name: roomName, maxParticipants };
    },
    async countParticipants() {
      return count;
    },
    setCount(next) {
      count = next;
    },
    async listParticipants() {
      return [...participants.values()];
    },
    trackParticipant(identity, name = 'Participant') {
      participants.set(identity, { identity, name });
      count = participants.size;
    },
    async removeParticipant(_room, identity) {
      participants.delete(identity);
      count = participants.size;
    },
    async deleteRoom() {
      participants.clear();
      count = 0;
    },
  };
}

async function seedRoom(t, overrides = {}) {
  const now = overrides.now || (() => Date.parse('2026-09-25T12:00:00.000Z'));
  const repository = overrides.repository || createMemoryRoomRepository({ now });
  const result = await createRoom({
    title: overrides.title || 'Rejoin Test Room',
    accessCode: overrides.accessCode || ACCESS_CODE,
    expiresAt: overrides.expiresAt,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy({
      inviteDefaultMaxUses: overrides.maxUses ?? 6,
      ...overrides.policy,
    }),
    now,
  });
  t.after?.(async () => {
    if (result.room?.id) await repository.deleteRoomCascade(result.room.id);
  });
  return { result, repository, now };
}

test('first join consumes one invite use and returns a rejoin token', async (t) => {
  const seed = await seedRoom(t);
  const livekitRooms = createMockLiveKit();
  const admitted = await joinRoomAsParticipant({
    slug: seed.result.room.slug,
    inviteToken: seed.result._test.rawToken,
    displayName: 'First',
    accessCode: ACCESS_CODE,
    repository: seed.repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    policy: testPolicy(),
    now: seed.now,
  });

  assert.ok(admitted.participant.rejoinToken);
  const invite = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(invite.used_count, 1);

  const grant = await seed.repository.getParticipantRejoinGrantByTokenHash(
    hashRejoinToken(admitted.participant.rejoinToken),
  );
  assert.ok(grant);
  assert.equal(grant.room_id, seed.result.room.id);
  assert.equal(grant.invite_id, invite.id);
  assert.equal(grant.participant_identity, admitted.participant.identity);
  assert.equal(grant.revoked_at, null);
  assert.equal(grant.token_hash.includes(admitted.participant.rejoinToken), false);
});

test('six first-time admissions exhaust invite; sixth can rejoin without consuming; seventh new is rejected', async (t) => {
  const seed = await seedRoom(t, { maxUses: 6 });
  const livekitRooms = createMockLiveKit();
  const admissions = [];

  for (let i = 0; i < 6; i += 1) {
    livekitRooms.setCount(i);
    const admitted = await joinRoomAsParticipant({
      slug: seed.result.room.slug,
      inviteToken: seed.result._test.rawToken,
      displayName: `User ${i + 1}`,
      accessCode: ACCESS_CODE,
      repository: seed.repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy({ inviteDefaultMaxUses: 6 }),
      now: seed.now,
    });
    admissions.push(admitted);
  }

  const invite = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(invite.used_count, 6);

  // Participant #6 leaves — capacity opens.
  livekitRooms.setCount(5);
  const sixth = admissions[5];
  const rejoined = await joinRoomAsParticipant({
    slug: seed.result.room.slug,
    inviteToken: seed.result._test.rawToken,
    displayName: 'User 6 again',
    accessCode: ACCESS_CODE,
    rejoinToken: sixth.participant.rejoinToken,
    repository: seed.repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    policy: testPolicy({ inviteDefaultMaxUses: 6 }),
    now: seed.now,
  });

  assert.ok(rejoined.token);
  assert.notEqual(rejoined.participant.identity, sixth.participant.identity);
  assert.equal(rejoined.participant.rejoinToken, sixth.participant.rejoinToken);

  const inviteAfter = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(inviteAfter.used_count, 6);

  // Seventh NEW participant without rejoin grant is rejected.
  livekitRooms.setCount(5);
  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: seed.result.room.slug,
      inviteToken: seed.result._test.rawToken,
      displayName: 'Seventh',
      accessCode: ACCESS_CODE,
      repository: seed.repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy({ inviteDefaultMaxUses: 6 }),
      now: seed.now,
    }),
    (error) => error instanceof RoomJoinError
      && error.httpStatus === 409
      && error.code === 'INVITE_EXHAUSTED',
  );
});

test('rejoin is rejected after coordinator removes that participant', async (t) => {
  const seed = await seedRoom(t);
  const livekitRooms = createMockLiveKit();
  const admitted = await joinRoomAsParticipant({
    slug: seed.result.room.slug,
    inviteToken: seed.result._test.rawToken,
    displayName: 'Removable',
    accessCode: ACCESS_CODE,
    repository: seed.repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    policy: testPolicy(),
    now: seed.now,
  });

  livekitRooms.trackParticipant(admitted.participant.identity, 'Removable');
  const room = await seed.repository.getRoomBySlug(seed.result.room.slug);
  await removeRoomParticipant({
    room,
    ownerId: room.owner_id,
    participantIdentity: admitted.participant.identity,
    repository: seed.repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    now: seed.now,
  });

  const grant = await seed.repository.getParticipantRejoinGrantByTokenHash(
    hashRejoinToken(admitted.participant.rejoinToken),
  );
  assert.ok(grant.revoked_at);

  livekitRooms.setCount(0);
  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: seed.result.room.slug,
      inviteToken: seed.result._test.rawToken,
      displayName: 'Removable',
      accessCode: ACCESS_CODE,
      rejoinToken: admitted.participant.rejoinToken,
      repository: seed.repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now: seed.now,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'REJOIN_REVOKED',
  );
});

test('rejoin is rejected after room ends or expires; cannot cross rooms; requires access code', async (t) => {
  const now = () => Date.parse('2026-09-25T12:00:00.000Z');
  const repository = createMemoryRoomRepository({ now });
  const seed = await createRoom({
    title: 'Rejoin Test Room',
    accessCode: ACCESS_CODE,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy({ inviteDefaultMaxUses: 6 }),
    now,
  });
  const other = await createRoom({
    title: 'Other Room',
    accessCode: ACCESS_CODE,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy({ inviteDefaultMaxUses: 6 }),
    now,
  });
  t.after(async () => {
    await repository.deleteRoomCascade(seed.room.id);
    await repository.deleteRoomCascade(other.room.id);
  });

  const livekitRooms = createMockLiveKit();

  const admitted = await joinRoomAsParticipant({
    slug: seed.room.slug,
    inviteToken: seed._test.rawToken,
    displayName: 'Cross',
    accessCode: ACCESS_CODE,
    repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    policy: testPolicy(),
    now,
  });

  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: other.room.slug,
      inviteToken: other._test.rawToken,
      displayName: 'Cross',
      accessCode: ACCESS_CODE,
      rejoinToken: admitted.participant.rejoinToken,
      repository,
      livekitRooms: createMockLiveKit(),
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'REJOIN_INVALID',
  );

  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: seed.room.slug,
      inviteToken: seed._test.rawToken,
      displayName: 'Cross',
      accessCode: 'wrong-access-code-xx',
      rejoinToken: admitted.participant.rejoinToken,
      repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'ACCESS_CODE_INVALID',
  );

  const room = await repository.getRoomBySlug(seed.room.slug);
  await endRoom({
    room,
    ownerId: room.owner_id,
    repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    now,
  });

  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: seed.room.slug,
      inviteToken: seed._test.rawToken,
      displayName: 'Cross',
      accessCode: ACCESS_CODE,
      rejoinToken: admitted.participant.rejoinToken,
      repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'ROOM_ENDED',
  );

  // Expiry path
  const expNow = () => Date.parse('2026-09-25T12:00:00.000Z');
  const expRepo = createMemoryRoomRepository({ now: expNow });
  const expSeed = await createRoom({
    title: 'Expiring',
    accessCode: ACCESS_CODE,
    expiresAt: new Date(Date.parse('2026-09-25T12:00:00.000Z') + 60_000).toISOString(),
    baseUrl: 'https://example.test',
    repository: expRepo,
    policy: testPolicy({ inviteDefaultMaxUses: 6 }),
    now: expNow,
  });
  t.after(async () => expRepo.deleteRoomCascade(expSeed.room.id));

  const expLivekit = createMockLiveKit();
  const expAdmitted = await joinRoomAsParticipant({
    slug: expSeed.room.slug,
    inviteToken: expSeed._test.rawToken,
    displayName: 'Expiring user',
    accessCode: ACCESS_CODE,
    repository: expRepo,
    livekitRooms: expLivekit,
    livekitCredentials: LIVEKIT,
    policy: testPolicy(),
    now: expNow,
  });

  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: expSeed.room.slug,
      inviteToken: expSeed._test.rawToken,
      displayName: 'Expiring user',
      accessCode: ACCESS_CODE,
      rejoinToken: expAdmitted.participant.rejoinToken,
      repository: expRepo,
      livekitRooms: expLivekit,
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now: () => Date.parse('2026-09-25T12:00:00.000Z') + 120_000,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'ROOM_EXPIRED',
  );
});

test('slug/meeting ID alone cannot authorize entry; invite token required', async (t) => {
  const seed = await seedRoom(t);
  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: seed.result.room.slug,
      inviteToken: '',
      displayName: 'NoInvite',
      accessCode: ACCESS_CODE,
      repository: seed.repository,
      livekitRooms: createMockLiveKit(),
      livekitCredentials: LIVEKIT,
      policy: testPolicy(),
      now: seed.now,
    }),
    (error) => error instanceof RoomJoinError && error.code === 'INVITE_INVALID',
  );
});

test('rejoin storage is scoped by room slug and never puts tokens in URLs', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };

  assert.equal(saveRejoinToken('room-a', 'token-a', storage), true);
  assert.equal(readRejoinToken('room-a', storage), 'token-a');
  assert.equal(readRejoinToken('room-b', storage), null);
  assert.equal(clearRejoinToken('room-a', storage), true);
  assert.equal(readRejoinToken('room-a', storage), null);
});
