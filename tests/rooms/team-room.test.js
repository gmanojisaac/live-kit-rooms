import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../../lib/rooms/service.js';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import { joinRoomAsParticipant, RoomJoinError } from '../../lib/rooms/join.js';
import { getRoomPolicy, MAX_PARTICIPANTS } from '../../lib/rooms/policy.js';
import { parseTeamMembers, matchTeamMember } from '../../lib/rooms/team.js';
import { computeTokenExpiry } from '../../lib/livekit/token.js';

const ACCESS_CODE = 'test-access-code-ok';
const LIVEKIT = {
  url: 'wss://example.livekit.cloud',
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret-value-for-jwt',
};

function policy(extraEnv = {}) {
  return getRoomPolicy({
    OWNER_SESSION_SECRET: 'test-owner-session-secret-32chars!!',
    ...extraEnv,
  });
}

const livekitRooms = {
  countParticipants: async () => 0,
  ensureRoom: async (name) => ({ name, maxParticipants: MAX_PARTICIPANTS }),
};

async function seed({ permanent = false, env = {}, now = Date.now } = {}) {
  const repository = createMemoryRoomRepository({ now });
  const roomPolicy = policy(env);
  const created = await createRoom({
    title: 'Team room',
    accessCode: ACCESS_CODE,
    permanent,
    baseUrl: 'https://example.test',
    repository,
    policy: roomPolicy,
    now,
  });
  const join = (displayName) => joinRoomAsParticipant({
    slug: created.room.slug,
    inviteToken: created._test.rawToken,
    displayName,
    accessCode: ACCESS_CODE,
    repository,
    livekitRooms,
    livekitCredentials: LIVEKIT,
    policy: roomPolicy,
    now,
  });
  return { repository, created, join };
}

test('TEAM_MEMBERS parses to unique normalized names', () => {
  assert.deepEqual(parseTeamMembers(' Asha ,Ravi,, asha ,  Kiran  Rao '), ['Asha', 'Ravi', 'Kiran Rao']);
  assert.deepEqual(parseTeamMembers(''), []);
  assert.deepEqual(parseTeamMembers(undefined), []);
  assert.equal(matchTeamMember('  ravi ', ['Asha', 'Ravi']), 'Ravi');
  assert.equal(matchTeamMember('Mallory', ['Asha', 'Ravi']), null);
  assert.deepEqual([...policy({ TEAM_MEMBERS: 'Asha,Ravi' }).teamMembers], ['Asha', 'Ravi']);
  assert.deepEqual([...policy().teamMembers], []);
});

test('with a roster, only team members can join and names are canonicalized', async () => {
  const { join } = await seed({ env: { TEAM_MEMBERS: 'Asha,Ravi,Kiran' } });

  const admitted = await join('ravi');
  assert.equal(admitted.participant.displayName, 'Ravi');

  await assert.rejects(
    () => join('Mallory'),
    (error) => error instanceof RoomJoinError && error.code === 'NOT_A_TEAM_MEMBER',
  );
});

test('without a roster, free-form display names still work', async () => {
  const { join } = await seed();
  const admitted = await join('Guest Reviewer');
  assert.equal(admitted.participant.displayName, 'Guest Reviewer');
});

test('permanent room never expires and its invite has no use limit', async () => {
  let current = Date.parse('2026-10-02T09:00:00.000Z');
  const now = () => current;
  const { created, join, repository } = await seed({ permanent: true, now });

  assert.equal(created.room.expiresAt, null);
  assert.equal(created.invite.maxUses, null);
  assert.equal(created.invite.expiresAt, null);

  // Far more first-time joins than the default six-use invitation allows, a year apart.
  for (let i = 0; i < 10; i += 1) {
    const admitted = await join(`Member ${i}`);
    assert.ok(admitted.token);
  }
  current += 365 * 24 * 60 * 60 * 1000;
  const later = await join('Next year');
  assert.equal(later.room.expiresAt, null);

  const room = await repository.getRoomBySlug(created.room.slug);
  assert.equal(room.status, 'active');
});

test('token expiry for a permanent room uses the configured TTL only', () => {
  const now = () => Date.parse('2026-10-02T09:00:00.000Z');
  const expiry = computeTokenExpiry({ now, roomExpiresAt: null, configuredTtlSeconds: 3600 });
  assert.equal(expiry.ok, true);
  assert.equal(expiry.ttlSeconds, 3600);
  assert.equal(expiry.expiresAt.getTime(), now() + 3600 * 1000);
});
