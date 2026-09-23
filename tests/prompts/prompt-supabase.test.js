/**
 * Optional Phase 4 Supabase integration for prompt snapshots + versions.
 * Skips when service-role credentials are unavailable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoom } from '../../lib/rooms/service.js';
import { createRoomRepository } from '../../lib/rooms/repository.js';
import {
  persistPromptSnapshot,
  finalizePrompt,
  getPromptWorkspace,
  PromptError,
} from '../../lib/prompts/service.js';
import { setPromptLock } from '../../lib/rooms/moderation.js';
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

const ACCESS_CODE = 'phase4-supabase-code!!';
const SESSION_SECRET = process.env.OWNER_SESSION_SECRET || 'test-owner-session-secret-32chars!!';

function testPolicy() {
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

test('supabase prompt snapshot + named version + lock isolation', async (t) => {
  if (!hasSupabase) {
    t.skip('Supabase service role not configured');
    return;
  }

  const repository = createRoomRepository();
  const created = await createRoom({
    title: `Phase4 Prompt ${Date.now()}`,
    accessCode: ACCESS_CODE,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy(),
  });
  const room = await repository.getRoomBySlug(created.room.slug);
  assert.ok(room);

  t.after(async () => {
    try {
      await repository.deleteRoomCascade(room.id);
    } catch {
      // best-effort cleanup
    }
  });

  const snap = await persistPromptSnapshot({
    slug: room.slug,
    content: 'Supabase durable draft',
    yjsState: 'dGVzdA==',
    updatedBy: 'Integration',
    repository,
  });
  assert.equal(snap.draft, 'Supabase durable draft');
  assert.ok(snap.revision >= 1);

  const version = await finalizePrompt({
    slug: room.slug,
    content: 'Supabase durable draft',
    name: 'Integration Version',
    finalizedBy: 'Integration',
    repository,
  });
  assert.equal(version.name, 'Integration Version');
  assert.equal(version.prompt, 'Supabase durable draft');

  await setPromptLock({
    room,
    ownerId: created.owner.id,
    locked: true,
    repository,
  });
  await assert.rejects(
    () => persistPromptSnapshot({
      slug: room.slug,
      content: 'should fail',
      repository,
    }),
    (err) => err instanceof PromptError && err.code === 'PROMPT_LOCKED',
  );

  const ws = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(ws.isLocked, true);
  assert.equal(ws.versions.some((v) => v.name === 'Integration Version'), true);
});
