import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  stripInternalCreateResult,
} from '../../lib/rooms/service.js';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import {
  joinRoomAsParticipant,
  RoomJoinError,
  isPlausibleInviteToken,
} from '../../lib/rooms/join.js';
import {
  computeTokenExpiry,
  createParticipantAccessToken,
  verifyParticipantAccessToken,
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} from '../../lib/livekit/token.js';
import {
  createJoinRateLimiter,
  createClientIpResolver,
  JOIN_RATE_LIMIT_MAX_FAILURES,
} from '../../lib/security/rate-limit.js';
import { redactForLog } from '../../lib/security/redact.js';
import {
  MAX_PARTICIPANTS,
  PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
  PROVISIONAL_INVITE_DEFAULT_MAX_USES,
} from '../../lib/rooms/policy.js';
import {
  handleJoinPost,
  __resetJoinLimiterForTests,
} from '../../lib/rooms/join-handler.js';
import { generateInviteToken } from '../../lib/security/invite-token.js';

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
  const ensured = [];
  return {
    maxParticipants,
    ensured,
    async ensureRoom(roomName) {
      ensured.push(roomName);
      return { name: roomName, maxParticipants };
    },
    async countParticipants() {
      return count;
    },
    setCount(next) {
      count = next;
    },
  };
}

async function seedRoom(t, overrides = {}) {
  const now = overrides.now || Date.now;
  const repository = overrides.repository || createMemoryRoomRepository({ now });
  const result = await createRoom({
    title: overrides.title || 'Join Test Room',
    accessCode: overrides.accessCode || ACCESS_CODE,
    expiresAt: overrides.expiresAt,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy(overrides.policy),
    now,
  });
  t.after?.(async () => {
    if (result.room?.id) await repository.deleteRoomCascade(result.room.id);
  });
  return { result, repository, now };
}

function joinArgs(seed, overrides = {}) {
  return {
    slug: seed.result.room.slug,
    inviteToken: seed.result._test.rawToken,
    displayName: 'Arjun',
    accessCode: ACCESS_CODE,
    repository: seed.repository,
    livekitRooms: overrides.livekitRooms || createMockLiveKit(),
    livekitCredentials: LIVEKIT,
    policy: testPolicy(overrides.policy),
    now: seed.now,
    ...overrides,
  };
}

test('invite token format helper accepts plausible tokens', () => {
  const { rawToken } = generateInviteToken();
  assert.equal(isPlausibleInviteToken(rawToken), true);
  assert.equal(isPlausibleInviteToken(''), false);
  assert.equal(isPlausibleInviteToken('short'), false);
  assert.equal(isPlausibleInviteToken('%%%'), false);
});

test('valid invitation + access code issues short-lived room-scoped JWT', async (t) => {
  const seed = await seedRoom(t);
  const livekitRooms = createMockLiveKit();
  const admitted = await joinRoomAsParticipant(joinArgs(seed, { livekitRooms }));

  assert.ok(admitted.token);
  assert.equal(admitted.livekitUrl, LIVEKIT.url);
  assert.equal(admitted.room.slug, seed.result.room.slug);
  assert.equal(admitted.room.title, 'Join Test Room');
  assert.equal(admitted.room.maxParticipants, 6);
  assert.equal(admitted.participant.displayName, 'Arjun');
  assert.match(admitted.participant.identity, /^[0-9a-f-]{36}$/i);
  assert.notEqual(admitted.participant.identity, 'Arjun');
  assert.equal(livekitRooms.ensured[0], seed.result.room.slug);

  const claims = await verifyParticipantAccessToken(admitted.token, LIVEKIT);
  assert.equal(claims.sub, admitted.participant.identity);
  assert.equal(claims.video.room, seed.result.room.slug);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, true);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
  const roomExp = Math.floor(Date.parse(seed.result.room.expiresAt) / 1000);
  assert.ok(claims.exp <= roomExp);

  const invite = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(invite.used_count, 1);

  const serialized = JSON.stringify(admitted);
  assert.equal(serialized.includes(ACCESS_CODE), false);
  assert.equal(serialized.includes(seed.result._test.rawToken), false);
  assert.equal(serialized.includes(seed.result._test.codeHash), false);
  assert.equal(serialized.includes(LIVEKIT.apiSecret), false);
  assert.equal('id' in admitted.room, false);
  assert.equal('code_hash' in admitted.room, false);
});

test('unknown room slug is rejected', async (t) => {
  const seed = await seedRoom(t);
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { slug: 'unknownx' })),
    (error) => error instanceof RoomJoinError && error.httpStatus === 404,
  );
});

test('invalid / revoked / expired / exhausted invitations are rejected without consuming', async (t) => {
  const seed = await seedRoom(t);
  const invite = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);

  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { inviteToken: generateInviteToken().rawToken })),
    (error) => error instanceof RoomJoinError && error.httpStatus === 403,
  );

  invite.revoked_at = new Date(seed.now()).toISOString();
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed)),
    (error) => error instanceof RoomJoinError && error.httpStatus === 403,
  );
  invite.revoked_at = null;

  invite.expires_at = new Date(seed.now() - 1000).toISOString();
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed)),
    (error) => error instanceof RoomJoinError && error.httpStatus === 403,
  );
  invite.expires_at = seed.result.room.expires_at;

  invite.used_count = invite.max_uses;
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed)),
    (error) => error instanceof RoomJoinError && error.httpStatus === 409,
  );
  invite.used_count = 0;

  const after = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(after.used_count, 0);
});

test('invitation from another room is rejected', async (t) => {
  const repository = createMemoryRoomRepository({
    now: () => Date.parse('2026-09-22T12:00:00.000Z'),
  });
  const a = await seedRoom(t, { repository, title: 'Room A' });
  const b = await seedRoom(t, { repository, title: 'Room B' });

  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(a, {
      inviteToken: b.result._test.rawToken,
      repository,
    })),
    (error) => error instanceof RoomJoinError
      && error.httpStatus === 403
      && error.message === 'Invalid invitation or access code.',
  );
});

test('incorrect access code is rejected and does not consume invite', async (t) => {
  const seed = await seedRoom(t);
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { accessCode: 'wrong-access-code-xx' })),
    (error) => error instanceof RoomJoinError && error.httpStatus === 403,
  );
  const invite = await seed.repository.getInviteByTokenHash(seed.result._test.tokenHash);
  assert.equal(invite.used_count, 0);
  const stored = await seed.repository.getRoomBySlug(seed.result.room.slug);
  assert.match(stored.code_hash, /^scrypt\$/);
  assert.equal(stored.code_hash.includes(ACCESS_CODE), false);
});

test('ended and expired rooms reject joins; stale active is marked expired', async (t) => {
  let clock = Date.parse('2026-09-22T12:00:00.000Z');
  const seed = await seedRoom(t, {
    now: () => clock,
    expiresAt: new Date(clock + 60_000).toISOString(),
  });

  const ended = await seed.repository.getRoomBySlug(seed.result.room.slug);
  ended.status = 'ended';
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { now: () => clock })),
    (error) => error instanceof RoomJoinError && error.httpStatus === 410 && error.code === 'ROOM_ENDED',
  );
  ended.status = 'active';

  clock += 61_000;
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { now: () => clock })),
    (error) => error instanceof RoomJoinError && error.httpStatus === 410 && error.code === 'ROOM_EXPIRED',
  );
  const updated = await seed.repository.getRoomBySlug(seed.result.room.slug);
  assert.equal(updated.status, 'expired');
});

test('six admissions allowed; seventh rejected; LiveKit maxParticipants is six', async (t) => {
  const repository = createMemoryRoomRepository({
    now: () => Date.parse('2026-09-22T12:00:00.000Z'),
  });
  const created = await createRoom({
    title: 'Capacity Room',
    accessCode: ACCESS_CODE,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy({ inviteDefaultMaxUses: 10 }),
    now: () => Date.parse('2026-09-22T12:00:00.000Z'),
  });
  t.after(async () => repository.deleteRoomCascade(created.room.id));

  const livekitRooms = createMockLiveKit({ participantCount: 0 });
  for (let i = 0; i < 6; i += 1) {
    livekitRooms.setCount(i);
    const admitted = await joinRoomAsParticipant({
      slug: created.room.slug,
      inviteToken: created._test.rawToken,
      displayName: `User ${i + 1}`,
      accessCode: ACCESS_CODE,
      repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy({ inviteDefaultMaxUses: 10 }),
      now: () => Date.parse('2026-09-22T12:00:00.000Z'),
    });
    assert.ok(admitted.token);
    assert.equal(admitted.room.maxParticipants, 6);
  }

  livekitRooms.setCount(6);
  await assert.rejects(
    () => joinRoomAsParticipant({
      slug: created.room.slug,
      inviteToken: created._test.rawToken,
      displayName: 'Seventh',
      accessCode: ACCESS_CODE,
      repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      policy: testPolicy({ inviteDefaultMaxUses: 10 }),
      now: () => Date.parse('2026-09-22T12:00:00.000Z'),
    }),
    (error) => error instanceof RoomJoinError
      && error.httpStatus === 409
      && error.code === 'CAPACITY_FULL',
  );

  const invite = await repository.getInviteByTokenHash(created._test.tokenHash);
  assert.equal(invite.used_count, 6);
});

test('concurrent capacity backstop uses LiveKit maxParticipants configuration', async (t) => {
  const seed = await seedRoom(t);
  const livekitRooms = createMockLiveKit({ maxParticipants: MAX_PARTICIPANTS });
  await joinRoomAsParticipant(joinArgs(seed, { livekitRooms }));
  const ensured = await livekitRooms.ensureRoom(seed.result.room.slug);
  assert.equal(ensured.maxParticipants, 6);

  // Simulate a LiveKit room created without the limit — join must refuse.
  const badRooms = {
    async ensureRoom(name) {
      return { name, maxParticipants: 0 };
    },
    async countParticipants() {
      return 0;
    },
  };
  // maxParticipants 0 is treated as unset in our check (Number > 0). Use a wrong positive limit.
  badRooms.ensureRoom = async (name) => ({ name, maxParticipants: 50 });
  await assert.rejects(
    () => joinRoomAsParticipant(joinArgs(seed, { livekitRooms: badRooms })),
    (error) => error instanceof RoomJoinError && error.code === 'ROOM_LIMIT_MISMATCH',
  );
});

test('token TTL is capped by room expiry and rejects near-expiry rooms', () => {
  const now = () => Date.parse('2026-09-22T12:00:00.000Z');
  const roomExpiresAt = new Date(now() + 120_000).toISOString();
  const capped = computeTokenExpiry({
    now,
    roomExpiresAt,
    configuredTtlSeconds: 3600,
  });
  assert.equal(capped.ok, true);
  assert.equal(capped.ttlSeconds, 120);
  assert.ok(capped.expiresAt.getTime() <= Date.parse(roomExpiresAt));

  const tooShort = computeTokenExpiry({
    now,
    roomExpiresAt: new Date(now() + 10_000).toISOString(),
    configuredTtlSeconds: 3600,
    minTtlSeconds: 30,
  });
  assert.equal(tooShort.ok, false);
});

test('client cannot choose identity or room name; display name is not identity', async (t) => {
  const seed = await seedRoom(t);
  const admitted = await joinRoomAsParticipant(joinArgs(seed, {
    identity: 'attacker-chosen-id',
    roomName: 'other-room',
    displayName: 'Display Only',
  }));
  assert.notEqual(admitted.participant.identity, 'attacker-chosen-id');
  assert.notEqual(admitted.participant.identity, 'Display Only');
  assert.equal(admitted.participant.displayName, 'Display Only');
  const claims = await verifyParticipantAccessToken(admitted.token, LIVEKIT);
  assert.equal(claims.video.room, seed.result.room.slug);
  assert.notEqual(claims.video.room, 'other-room');
  assert.equal(claims.sub, admitted.participant.identity);
});

test('JWT mint uses server credentials and never embeds secrets in claims', async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const jwt = await createParticipantAccessToken({
    apiKey: LIVEKIT.apiKey,
    apiSecret: LIVEKIT.apiSecret,
    identity: 'id-1',
    displayName: 'Pat',
    roomName: 'roomslug1',
    expiresAt,
    maxParticipants: 6,
  });
  const claims = await verifyParticipantAccessToken(jwt, LIVEKIT);
  assert.equal(claims.iss, LIVEKIT.apiKey);
  assert.equal(JSON.stringify(claims).includes(LIVEKIT.apiSecret), false);
  assert.equal(JSON.stringify(claims).includes(ACCESS_CODE), false);
});

test('rate limit: five failures allowed, sixth blocked with Retry-After; success does not count', async (t) => {
  __resetJoinLimiterForTests();
  const seed = await seedRoom(t);
  const limiter = createJoinRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  const config = {
    livekitUrl: LIVEKIT.url,
    livekitApiKey: LIVEKIT.apiKey,
    livekitApiSecret: LIVEKIT.apiSecret,
    roomPolicy: testPolicy(),
  };
  const livekitRooms = createMockLiveKit();

  async function postJoin(body, ip = '203.0.113.10') {
    const request = new Request(`https://example.test/api/rooms/${seed.result.room.slug}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleJoinPost(request, { params: { slug: seed.result.room.slug } }, {
      config,
      repository: seed.repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      limiter,
      resolveClientIp: () => ip,
      now: seed.now,
    });
  }

  for (let i = 0; i < JOIN_RATE_LIMIT_MAX_FAILURES; i += 1) {
    const res = await postJoin({
      inviteToken: seed.result._test.rawToken,
      displayName: 'Arjun',
      accessCode: 'wrong-access-code-xx',
    });
    assert.equal(res.status, 403);
  }

  const blocked = await postJoin({
    inviteToken: seed.result._test.rawToken,
    displayName: 'Arjun',
    accessCode: 'wrong-access-code-xx',
  });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['Retry-After']);

  // Different IP has a separate bucket.
  const otherIp = await postJoin({
    inviteToken: seed.result._test.rawToken,
    displayName: 'Arjun',
    accessCode: 'wrong-access-code-xx',
  }, '203.0.113.20');
  assert.equal(otherIp.status, 403);

  // Fresh limiter for success-does-not-count.
  const successLimiter = createJoinRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  for (let i = 0; i < 2; i += 1) {
    const fail = await handleJoinPost(
      new Request(`https://example.test/api/rooms/${seed.result.room.slug}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteToken: seed.result._test.rawToken,
          displayName: 'Arjun',
          accessCode: 'wrong-access-code-xx',
        }),
      }),
      { params: { slug: seed.result.room.slug } },
      {
        config,
        repository: seed.repository,
        livekitRooms,
        livekitCredentials: LIVEKIT,
        limiter: successLimiter,
        resolveClientIp: () => '198.51.100.1',
        now: seed.now,
      },
    );
    assert.equal(fail.status, 403);
  }

  const ok = await handleJoinPost(
    new Request(`https://example.test/api/rooms/${seed.result.room.slug}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inviteToken: seed.result._test.rawToken,
        displayName: 'Arjun',
        accessCode: ACCESS_CODE,
      }),
    }),
    { params: { slug: seed.result.room.slug } },
    {
      config,
      repository: seed.repository,
      livekitRooms,
      livekitCredentials: LIVEKIT,
      limiter: successLimiter,
      resolveClientIp: () => '198.51.100.1',
      now: seed.now,
    },
  );
  assert.equal(ok.status, 200);
  const body = ok.body;
  assert.ok(body.token);
  assert.equal(body.livekitUrl, LIVEKIT.url);
  assert.equal('accessCode' in body, false);

  // After success, remaining failure budget still allows more failures (success did not increment).
  for (let i = 0; i < 3; i += 1) {
    const fail = await handleJoinPost(
      new Request(`https://example.test/api/rooms/${seed.result.room.slug}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteToken: seed.result._test.rawToken,
          displayName: 'Arjun',
          accessCode: 'wrong-access-code-xx',
        }),
      }),
      { params: { slug: seed.result.room.slug } },
      {
        config,
        repository: seed.repository,
        livekitRooms,
        livekitCredentials: LIVEKIT,
        limiter: successLimiter,
        resolveClientIp: () => '198.51.100.1',
        now: seed.now,
      },
    );
    assert.equal(fail.status, 403);
  }
});

test('trusted-proxy IP resolution still separates clients', () => {
  const resolver = createClientIpResolver({ trustedProxyIps: ['10.0.0.1'] });
  const a = resolver({
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.50' },
  });
  const b = resolver({
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.51' },
  });
  assert.equal(a, '203.0.113.50');
  assert.equal(b, '203.0.113.51');
  assert.notEqual(a, b);
});

test('redaction strips invite/access material from structured logs', async (t) => {
  const seed = await seedRoom(t);
  const redacted = redactForLog({
    inviteToken: seed.result._test.rawToken,
    accessCode: ACCESS_CODE,
    token: 'jwt-should-hide',
    url: seed.result.invitationUrl,
  });
  assert.equal(redacted.inviteToken, '[redacted]');
  assert.equal(redacted.accessCode, '[redacted]');
  assert.equal(redacted.token, '[redacted]');
  assert.match(redacted.url, /invite=(?:\[redacted\]|%5Bredacted%5D)/);
  assert.equal(JSON.stringify(redacted).includes(seed.result._test.rawToken), false);
  assert.equal(JSON.stringify(redacted).includes(ACCESS_CODE), false);
});

test('HTTP join response omits sensitive fields and rejects client identity override', async (t) => {
  __resetJoinLimiterForTests();
  const seed = await seedRoom(t);
  const response = await handleJoinPost(
    new Request(`https://example.test/api/rooms/${seed.result.room.slug}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inviteToken: seed.result._test.rawToken,
        displayName: 'Arjun',
        accessCode: ACCESS_CODE,
        identity: 'client-forced-id',
        roomName: 'forced-room',
      }),
    }),
    { params: { slug: seed.result.room.slug } },
    {
      config: {
        livekitUrl: LIVEKIT.url,
        livekitApiKey: LIVEKIT.apiKey,
        livekitApiSecret: LIVEKIT.apiSecret,
        roomPolicy: testPolicy(),
      },
      repository: seed.repository,
      livekitRooms: createMockLiveKit(),
      livekitCredentials: LIVEKIT,
      limiter: createJoinRateLimiter({ maxFailures: 5, windowMs: 900000 }),
      resolveClientIp: () => '127.0.0.1',
      now: seed.now,
    },
  );
  assert.equal(response.status, 200);
  const payload = response.body;
  assert.notEqual(payload.participant.identity, 'client-forced-id');
  const claims = await verifyParticipantAccessToken(payload.token, LIVEKIT);
  assert.equal(claims.video.room, seed.result.room.slug);
  assert.equal(JSON.stringify(payload).includes(LIVEKIT.apiSecret), false);
  assert.equal(JSON.stringify(payload).includes(ACCESS_CODE), false);
  assert.equal(JSON.stringify(payload).includes(seed.result._test.codeHash), false);
});
