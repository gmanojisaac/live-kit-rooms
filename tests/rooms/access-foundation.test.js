import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashAccessCode,
  verifyAccessCode,
  validateAccessCodeFormat,
  extractAccessCodeSaltForTests,
} from '../../lib/security/access-code.js';
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TOKEN_BYTES,
} from '../../lib/security/invite-token.js';
import {
  createOwnerSession,
  verifyOwnerSession,
  ownerSessionCookieOptions,
} from '../../lib/security/owner-session.js';
import {
  createJoinRateLimiter,
  createRateLimiter,
  createClientIpResolver,
  JOIN_RATE_LIMIT_MAX_FAILURES,
  JOIN_RATE_LIMIT_WINDOW_MS,
} from '../../lib/security/rate-limit.js';
import { redactForLog, redactUrl } from '../../lib/security/redact.js';
import {
  createRoom,
  resolveOwnerForCreation,
  stripInternalCreateResult,
  RoomCreationError,
} from '../../lib/rooms/service.js';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import { getRoomBySlug } from '../../lib/rooms/lookup.js';
import {
  validateRoomAccess,
  evaluateInvite,
  AccessRejection,
} from '../../lib/rooms/access-validation.js';
import { resolveRoomStatus } from '../../lib/rooms/status.js';
import {
  JOIN_RATE_LIMIT_MAX_FAILURES as POLICY_JOIN_MAX,
  JOIN_RATE_LIMIT_WINDOW_MS as POLICY_JOIN_WINDOW,
  MAX_PARTICIPANTS,
  PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
  PROVISIONAL_INVITE_DEFAULT_MAX_USES,
} from '../../lib/rooms/policy.js';

const SESSION_SECRET = 'test-owner-session-secret-32chars!!';
const ACCESS_CODE = 'test-access-code-ok';

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

async function createTestRoom(t, overrides = {}) {
  const repository = createMemoryRoomRepository();
  const now = overrides.now || Date.now;
  const result = await createRoom({
    title: overrides.title || 'Team Prompt Review',
    accessCode: overrides.accessCode || ACCESS_CODE,
    expiresAt: overrides.expiresAt,
    baseUrl: 'https://example.test',
    existingSessionToken: overrides.existingSessionToken,
    creationSecretProvided: overrides.creationSecretProvided,
    repository,
    policy: testPolicy(overrides.policy),
    now,
  });
  t.after?.(async () => {
    if (result.room?.id) await repository.deleteRoomCascade(result.room.id);
  });
  return { result, repository, now };
}

test('access-code format rejects short codes', () => {
  assert.equal(validateAccessCodeFormat('short').ok, false);
  assert.equal(validateAccessCodeFormat(ACCESS_CODE).ok, true);
});

test('access-code hashing uses unique salts and verifies correctly', async () => {
  const a = await hashAccessCode(ACCESS_CODE);
  const b = await hashAccessCode(ACCESS_CODE);
  assert.notEqual(a, b);
  assert.notEqual(extractAccessCodeSaltForTests(a), extractAccessCodeSaltForTests(b));
  assert.equal(await verifyAccessCode(ACCESS_CODE, a), true);
  assert.equal(await verifyAccessCode(ACCESS_CODE, b), true);
  assert.equal(await verifyAccessCode('wrong-access-code-xx', a), false);
  assert.equal(a.includes(ACCESS_CODE), false);
  assert.match(a, /^scrypt\$/);
});

test('invitation tokens are 256-bit random and only hashes are comparable', () => {
  const first = generateInviteToken();
  const second = generateInviteToken();
  assert.notEqual(first.rawToken, second.rawToken);
  assert.equal(Buffer.from(first.rawToken, 'base64url').length, INVITE_TOKEN_BYTES);
  assert.equal(hashInviteToken(first.rawToken), first.tokenHash);
  assert.notEqual(first.tokenHash, first.rawToken);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
});

test('owner session round-trip, rejection of tampering, and cookie flags', () => {
  let clock = 1_000_000;
  const session = createOwnerSession(SESSION_SECRET, { now: () => clock });
  const verified = verifyOwnerSession(session.token, SESSION_SECRET, { now: () => clock });
  assert.equal(verified.ownerId, session.ownerId);

  const tampered = `${session.token.slice(0, -4)}xxxx`;
  assert.equal(verifyOwnerSession(tampered, SESSION_SECRET, { now: () => clock }), null);
  assert.equal(verifyOwnerSession(session.token, 'wrong-secret-wrong-secret-wrong!!', { now: () => clock }), null);

  clock += 13 * 60 * 60 * 1000;
  assert.equal(verifyOwnerSession(session.token, SESSION_SECRET, { now: () => clock }), null);

  const prod = ownerSessionCookieOptions({ isProduction: true, maxAgeSeconds: 60 });
  const dev = ownerSessionCookieOptions({ isProduction: false, maxAgeSeconds: 60 });
  assert.equal(prod.httpOnly, true);
  assert.equal(prod.secure, true);
  assert.equal(prod.sameSite, 'lax');
  assert.equal(prod.path, '/');
  assert.equal(dev.secure, false);
  assert.equal(dev.httpOnly, true);
});

test('missing owner session is rejected for host_secret creation mode', () => {
  assert.throws(
    () => resolveOwnerForCreation({
      policy: testPolicy({ creationMode: 'host_secret', creationSecret: 'host-secret-value-here!!!!' }),
      existingSessionToken: null,
      creationSecretProvided: 'wrong',
    }),
    (error) => error instanceof RoomCreationError && error.httpStatus === 401,
  );
});

test('room creation persists public fields and invitation URL without access code', async (t) => {
  const clock = Date.now();
  const { result, repository, now } = await createTestRoom(t, { now: () => clock });
  const { publicResult, _test } = stripInternalCreateResult(result);

  assert.equal(publicResult.room.maxParticipants, 6);
  assert.equal(publicResult.room.status, 'active');
  assert.ok(publicResult.room.slug);
  assert.ok(publicResult.room.expiresAt);
  assert.equal(publicResult.owner.id, result.owner.id);
  assert.match(publicResult.invitationUrl, /\/room\/[^?]+\?invite=/);
  assert.equal(publicResult.invitationUrl.includes(ACCESS_CODE), false);
  assert.ok(publicResult.invitationUrl.includes(_test.rawToken));
  assert.equal(JSON.stringify(publicResult).includes(_test.codeHash), false);
  assert.equal(JSON.stringify(publicResult).includes(_test.tokenHash), false);
  assert.equal(publicResult.accessCode, ACCESS_CODE);

  const stored = await repository.getRoomBySlug(publicResult.room.slug);
  assert.ok(stored);
  assert.equal(stored.owner_id, publicResult.owner.id);
  assert.equal(stored.code_hash.includes(ACCESS_CODE), false);
  assert.equal(stored.max_participants, 6);
  assert.equal(stored.status, 'active');

  const invite = await repository.getInviteByTokenHash(_test.tokenHash);
  assert.ok(invite);
  assert.equal(invite.used_count, 0);
  assert.equal(invite.revoked_at, null);
  assert.equal(invite.max_uses, null);
  assert.equal(invite.token_hash.includes(_test.rawToken), false);

  const expectedExpiry = now() + PROVISIONAL_DEFAULT_EXPIRY_MINUTES * 60 * 1000;
  assert.equal(Date.parse(stored.expires_at), expectedExpiry);
});

test('two rooms with the same access code produce different hashes', async (t) => {
  const a = await createTestRoom(t, { title: 'Room A' });
  const b = await createTestRoom(t, { title: 'Room B' });
  assert.notEqual(a.result._test.codeHash, b.result._test.codeHash);
  assert.notEqual(a.result.room.slug, b.result.room.slug);
});

test('room isolation: slug lookup and invite do not cross rooms', async (t) => {
  const a = await createTestRoom(t, { title: 'Alpha' });
  const b = await createTestRoom(t, { title: 'Beta' });

  const looked = await getRoomBySlug(a.result.room.slug, { repository: a.repository });
  assert.equal(looked.ok, true);
  assert.equal(looked.publicRoom.slug, a.result.room.slug);
  assert.equal('code_hash' in looked.publicRoom, false);

  const missing = await getRoomBySlug('missing12', { repository: a.repository });
  assert.equal(missing.ok, false);
  assert.equal(missing.httpStatus, 404);

  const cross = await validateRoomAccess({
    repository: a.repository,
    slug: a.result.room.slug,
    rawInviteToken: b.result._test.rawToken,
    accessCode: ACCESS_CODE,
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.reason, AccessRejection.INVITE_INVALID);
});

test('expired room is not joinable; invite cannot outlive room', async (t) => {
  let clock = Date.parse('2026-09-22T12:00:00.000Z');
  const { result, repository } = await createTestRoom(t, {
    now: () => clock,
    expiresAt: new Date(clock + 60_000).toISOString(),
  });

  clock += 61_000;
  assert.equal(resolveRoomStatus(await repository.getRoomBySlug(result.room.slug), { now: () => clock }), 'expired');

  const access = await validateRoomAccess({
    repository,
    slug: result.room.slug,
    rawInviteToken: result._test.rawToken,
    accessCode: ACCESS_CODE,
    now: () => clock,
  });
  assert.equal(access.ok, false);
  assert.equal(access.reason, AccessRejection.ROOM_EXPIRED);

  const invite = await repository.getInviteByTokenHash(result._test.tokenHash);
  // Invite configured to expire after the room must be treated as invalid.
  const inviteCheck = evaluateInvite({
    ...invite,
    expires_at: new Date(clock + 120_000).toISOString(),
  }, {
    now: () => clock - 30_000,
    roomExpiresAt: new Date(clock - 1_000).toISOString(),
  });
  assert.equal(inviteCheck.ok, false);
});

test('revoked invites are rejected; prior invite use count does not close capacity', async (t) => {
  const { result, repository } = await createTestRoom(t);
  const invite = await repository.getInviteByTokenHash(result._test.tokenHash);
  invite.revoked_at = new Date().toISOString();

  const revoked = await validateRoomAccess({
    repository,
    slug: result.room.slug,
    rawInviteToken: result._test.rawToken,
    accessCode: ACCESS_CODE,
  });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, AccessRejection.INVITE_REVOKED);

  invite.revoked_at = null;
  invite.max_uses = 1;
  invite.used_count = 1;
  const previouslyUsed = await validateRoomAccess({
    repository,
    slug: result.room.slug,
    rawInviteToken: result._test.rawToken,
    accessCode: ACCESS_CODE,
  });
  assert.equal(previouslyUsed.ok, true);

  const badCode = await validateRoomAccess({
    repository,
    slug: result.room.slug,
    rawInviteToken: result._test.rawToken,
    accessCode: 'incorrect-code!!',
  });
  assert.equal(badCode.ok, false);
  assert.equal(badCode.reason, AccessRejection.ACCESS_CODE_INVALID);
  assert.equal(invite.used_count, 1);
});

test('valid access foundation accepts invite + code for an active room', async (t) => {
  const { result, repository } = await createTestRoom(t);
  const ok = await validateRoomAccess({
    repository,
    slug: result.room.slug,
    rawInviteToken: result._test.rawToken,
    accessCode: ACCESS_CODE,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.room.slug, result.room.slug);
});

test('join rate-limit policy is 5 failures / 15 minutes with Retry-After', () => {
  assert.equal(JOIN_RATE_LIMIT_MAX_FAILURES, 5);
  assert.equal(JOIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(POLICY_JOIN_MAX, 5);
  assert.equal(POLICY_JOIN_WINDOW, 15 * 60 * 1000);

  let clock = 50_000_000;
  const limiter = createJoinRateLimiter({ now: () => clock });
  const ip = '203.0.113.50';

  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.check(ip).limited, false);
    limiter.recordFailure(ip);
  }
  const blocked = limiter.check(ip);
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.ok(blocked.retryAfterSeconds <= 15 * 60);

  // Successful requests are not recorded by callers — counter stays until window.
  assert.equal(limiter.check(ip).limited, true);

  const other = '203.0.113.51';
  assert.equal(limiter.check(other).limited, false);

  clock += JOIN_RATE_LIMIT_WINDOW_MS;
  assert.equal(limiter.check(ip).limited, false);
});

test('trusted proxy IP resolution remains intact', () => {
  const resolver = createClientIpResolver({ trustedProxyIps: ['10.0.0.1'] });
  const ip = resolver({
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' },
  });
  assert.equal(ip, '198.51.100.20');

  const untrusted = createClientIpResolver({ trustedProxyIps: [] });
  assert.equal(untrusted({
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-forwarded-for': '198.51.100.20' },
  }), '10.0.0.1');
});

test('room creation rate limiter is configurable', () => {
  let clock = 1;
  const limiter = createRateLimiter({ maxFailures: 2, windowMs: 60_000, now: () => clock });
  limiter.recordFailure('1.1.1.1');
  limiter.recordFailure('1.1.1.1');
  assert.equal(limiter.check('1.1.1.1').limited, true);
});

test('redaction strips invite tokens and sensitive keys', () => {
  const url = redactUrl('https://example.test/room/abc?invite=supersecret');
  assert.match(url, /invite=%5Bredacted%5D|invite=\[redacted\]/);
  const logged = redactForLog({
    accessCode: 'secret-code',
    invitationUrl: 'https://example.test/room/abc?invite=tok',
    roomSlug: 'abc',
  });
  assert.equal(logged.accessCode, '[redacted]');
  assert.equal(logged.roomSlug, 'abc');
  assert.match(logged.invitationUrl, /(%5Bredacted%5D|\[redacted\])/);
});
