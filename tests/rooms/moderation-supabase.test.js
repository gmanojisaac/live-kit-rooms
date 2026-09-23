/**
 * Optional AUTH-05 Supabase / LiveKit integration checks.
 * Skips when credentials are unavailable. Prefer mocked LiveKit mutations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoom, stripInternalCreateResult } from '../../lib/rooms/service.js';
import { createRoomRepository } from '../../lib/rooms/repository.js';
import { setPromptLock, revokeRoomInvitation, endRoom } from '../../lib/rooms/moderation.js';
import { putPromptDraft, getPromptWorkspace, PromptError } from '../../lib/prompts/service.js';
import { validateRoomAccess, AccessRejection } from '../../lib/rooms/access-validation.js';
import { AUDIT_EVENT } from '../../lib/rooms/audit.js';
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

function mockLiveKit() {
  return {
    async listParticipants() { return []; },
    async removeParticipant() {},
    async deleteRoom() {},
    async ensureRoom(name) { return { name, maxParticipants: MAX_PARTICIPANTS }; },
    async countParticipants() { return 0; },
  };
}

test('supabase AUTH-05 lock + revoke + end against development project', async (t) => {
  if (!hasSupabase) {
    t.skip('Supabase credentials not configured — skipping AUTH-05 integration test');
    return;
  }

  const repository = createRoomRepository();
  const accessCode = `auth05-code-${Date.now()}`;
  let roomId;

  t.after(async () => {
    if (roomId) {
      try {
        await repository.deleteRoomCascade(roomId);
      } catch {
        // best-effort
      }
    }
  });

  const created = await createRoom({
    title: 'AUTH-05 Integration',
    accessCode,
    baseUrl: 'https://example.test',
    repository,
    policy: policy(),
  });
  roomId = created.room.id;
  const { _test } = stripInternalCreateResult(created);
  const room = await repository.getRoomById(roomId);

  await putPromptDraft({
    slug: room.slug,
    draft: 'integration draft',
    repository,
  });

  await setPromptLock({
    room,
    ownerId: created.owner.id,
    locked: true,
    repository,
  });

  const doc = await repository.getPromptDocument(roomId);
  assert.equal(doc.is_locked, true);

  await assert.rejects(
    () => putPromptDraft({ slug: room.slug, draft: 'blocked', repository }),
    (e) => e instanceof PromptError && e.code === 'PROMPT_LOCKED',
  );

  await setPromptLock({
    room,
    ownerId: created.owner.id,
    locked: false,
    repository,
  });

  await revokeRoomInvitation({
    room,
    ownerId: created.owner.id,
    repository,
  });

  const access = await validateRoomAccess({
    repository,
    slug: room.slug,
    rawInviteToken: _test.rawToken,
    accessCode,
  });
  assert.equal(access.ok, false);
  assert.equal(access.reason, AccessRejection.INVITE_REVOKED);

  await endRoom({
    room,
    ownerId: created.owner.id,
    repository,
    livekitRooms: mockLiveKit(),
  });

  assert.equal((await repository.getRoomById(roomId)).status, 'ended');
  const workspace = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(workspace.readOnly, true);

  const audits = await repository.listAuditEvents(roomId);
  const types = new Set(audits.map((a) => a.event_type));
  assert.ok(types.has(AUDIT_EVENT.PROMPT_LOCKED));
  assert.ok(types.has(AUDIT_EVENT.PROMPT_UNLOCKED));
  assert.ok(types.has(AUDIT_EVENT.INVITATION_REVOKED));
  assert.ok(types.has(AUDIT_EVENT.ROOM_ENDED));
  const blob = JSON.stringify(audits);
  assert.equal(blob.includes(accessCode), false);
  assert.equal(blob.includes(_test.rawToken), false);
});
