/**
 * Optional integration against the configured Supabase project.
 * Skips cleanly when server credentials are unavailable.
 * Creates isolated rows and deletes them afterward.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoom, stripInternalCreateResult } from '../../lib/rooms/service.js';
import { createRoomRepository } from '../../lib/rooms/repository.js';
import { getRoomBySlug } from '../../lib/rooms/lookup.js';
import { validateRoomAccess } from '../../lib/rooms/access-validation.js';
import { joinRoomAsParticipant } from '../../lib/rooms/join.js';
import { verifyParticipantAccessToken } from '../../lib/livekit/token.js';
import { hashInviteToken } from '../../lib/security/invite-token.js';
import {
  MAX_PARTICIPANTS,
  PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
  PROVISIONAL_INVITE_DEFAULT_MAX_USES,
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} from '../../lib/rooms/policy.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env') });
loadEnv({ path: path.join(root, '.env.local'), override: true });

const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL
  && process.env.SUPABASE_SERVICE_ROLE_KEY
  && !String(process.env.SUPABASE_SERVICE_ROLE_KEY).includes('replace_with'),
);

const hasLiveKit = Boolean(
  process.env.NEXT_PUBLIC_LIVEKIT_URL
  && process.env.LIVEKIT_API_KEY
  && process.env.LIVEKIT_API_SECRET
  && !String(process.env.LIVEKIT_API_SECRET).includes('replace_with'),
);

const SESSION_SECRET = process.env.OWNER_SESSION_SECRET && process.env.OWNER_SESSION_SECRET.length >= 32
  ? process.env.OWNER_SESSION_SECRET
  : 'integration-test-owner-session-secret!!';

function policy() {
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
  };
}

function createMockLiveKit() {
  return {
    async ensureRoom(roomName) {
      return { name: roomName, maxParticipants: MAX_PARTICIPANTS };
    },
    async countParticipants() {
      return 0;
    },
  };
}

test('supabase-backed room creation + lookup + invite hash persistence', async (t) => {
  if (!hasSupabase) {
    t.skip('Supabase credentials not configured — skipping integration test');
    return;
  }

  const repository = createRoomRepository();
  const accessCode = `integration-code-${Date.now()}`;
  let roomId;

  t.after(async () => {
    if (roomId) {
      try {
        await repository.deleteRoomCascade(roomId);
      } catch {
        // best-effort cleanup
      }
    }
  });

  const created = await createRoom({
    title: 'Integration Room',
    accessCode,
    baseUrl: 'https://example.test',
    repository,
    policy: policy(),
  });
  roomId = created.room.id;

  const { publicResult, _test } = stripInternalCreateResult(created);
  assert.equal(publicResult.room.maxParticipants, 6);
  assert.equal(publicResult.room.status, 'active');
  assert.ok(publicResult.invitationUrl.includes(_test.rawToken));
  assert.equal(publicResult.invitationUrl.includes(accessCode), false);

  const looked = await getRoomBySlug(publicResult.room.slug, { repository });
  assert.equal(looked.ok, true);
  assert.equal(looked.publicRoom.id, publicResult.room.id);
  assert.equal('code_hash' in looked.publicRoom, false);

  const invite = await repository.getInviteByTokenHash(hashInviteToken(_test.rawToken));
  assert.ok(invite);
  assert.equal(invite.token_hash, _test.tokenHash);
  assert.equal(invite.token_hash.includes(_test.rawToken), false);
  assert.equal(invite.used_count, 0);
  assert.equal(invite.max_uses, PROVISIONAL_INVITE_DEFAULT_MAX_USES);

  const access = await validateRoomAccess({
    repository,
    slug: publicResult.room.slug,
    rawInviteToken: _test.rawToken,
    accessCode,
  });
  assert.equal(access.ok, true);

  const consumed = await repository.tryConsumeInvite(invite.id);
  assert.ok(consumed);
  assert.equal(consumed.used_count, 1);
});

test('supabase-backed join issues JWT and consumes invite atomically', async (t) => {
  if (!hasSupabase) {
    t.skip('Supabase credentials not configured — skipping integration test');
    return;
  }
  if (!hasLiveKit) {
    t.skip('LiveKit credentials not configured — skipping join integration test');
    return;
  }

  const repository = createRoomRepository();
  const accessCode = `join-integration-${Date.now()}`;
  let roomId;

  t.after(async () => {
    if (roomId) {
      try {
        await repository.deleteRoomCascade(roomId);
      } catch {
        // best-effort cleanup
      }
    }
  });

  const created = await createRoom({
    title: 'Join Integration Room',
    accessCode,
    baseUrl: 'https://example.test',
    repository,
    policy: policy(),
  });
  roomId = created.room.id;
  const { _test } = stripInternalCreateResult(created);

  const livekitCredentials = {
    url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
  };

  // Mock LiveKit room APIs so the test does not mutate LiveKit Cloud rooms.
  // Token minting still uses real API key/secret (AUTH-04 claims smoke).
  const admitted = await joinRoomAsParticipant({
    slug: created.room.slug,
    inviteToken: _test.rawToken,
    displayName: 'Integration Guest',
    accessCode,
    repository,
    livekitRooms: createMockLiveKit(),
    livekitCredentials,
    policy: policy(),
  });

  assert.ok(admitted.token);
  assert.equal(admitted.livekitUrl, livekitCredentials.url);
  assert.equal(admitted.room.maxParticipants, 6);
  assert.notEqual(admitted.participant.identity, 'Integration Guest');

  const claims = await verifyParticipantAccessToken(admitted.token, livekitCredentials);
  assert.equal(claims.video.room, created.room.slug);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.sub, admitted.participant.identity);
  assert.ok(claims.exp <= Math.floor(Date.parse(created.room.expiresAt) / 1000));

  const invite = await repository.getInviteByTokenHash(_test.tokenHash);
  assert.equal(invite.used_count, 1);

  assert.equal(JSON.stringify(admitted).includes(accessCode), false);
  assert.equal(JSON.stringify(admitted).includes(livekitCredentials.apiSecret), false);
});
