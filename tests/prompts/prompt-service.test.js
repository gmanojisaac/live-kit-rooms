/**
 * Phase 4 prompt service tests (persistence, versions, lock, end/expiry).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import { createRoom } from '../../lib/rooms/service.js';
import {
  getPromptWorkspace,
  persistPromptSnapshot,
  putPromptDraft,
  finalizePrompt,
  PromptError,
} from '../../lib/prompts/service.js';
import { setPromptLock, endRoom } from '../../lib/rooms/moderation.js';
import {
  createPromptDoc,
  applyLocalTextDiff,
  getPromptText,
  mergeDocs,
  encodeYjsStateBase64,
} from '../../lib/prompts/yjs-doc.js';
import {
  MAX_PARTICIPANTS,
  PROVISIONAL_DEFAULT_EXPIRY_MINUTES,
  PROVISIONAL_INVITE_DEFAULT_MAX_USES,
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} from '../../lib/rooms/policy.js';

const ACCESS_CODE = 'test-access-code-ok';
const SESSION_SECRET = 'test-owner-session-secret-32chars!!';

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
    maxRoomTitleLength: 120,
    minAccessCodeLength: 12,
    maxAccessCodeLength: 128,
    provisional: {},
    ...overrides,
  };
}

async function seedRoom(t, overrides = {}) {
  const now = overrides.now || Date.now;
  const repository = overrides.repository || createMemoryRoomRepository({ now });
  const result = await createRoom({
    title: overrides.title || 'Prompt Collab Room',
    accessCode: ACCESS_CODE,
    expiresAt: overrides.expiresAt,
    baseUrl: 'https://example.test',
    repository,
    policy: testPolicy(overrides.policy),
    now,
  });
  return {
    room: await repository.getRoomBySlug(result.room.slug),
    repository,
    ownerId: result.owner.id,
    now,
  };
}

test('snapshot persistence increments revision and stores yjs state', async (t) => {
  const { room, repository } = await seedRoom(t);
  const doc = createPromptDoc();
  applyLocalTextDiff(doc.ytext, 'Shared draft text');
  const snap = await persistPromptSnapshot({
    slug: room.slug,
    content: getPromptText(doc.doc),
    yjsState: encodeYjsStateBase64(doc.doc),
    updatedBy: 'Arjun',
    repository,
  });
  assert.equal(snap.draft, 'Shared draft text');
  assert.equal(snap.revision, 1);
  assert.ok(snap.yjsState);
  assert.equal(snap.updatedBy, 'Arjun');

  const again = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(again.draft, 'Shared draft text');
  assert.equal(again.revision, 1);
});

test('named finalize snapshots current shared content; draft remains editable', async (t) => {
  const { room, repository } = await seedRoom(t);
  await persistPromptSnapshot({
    slug: room.slug,
    content: 'Initial QA Prompt body',
    updatedBy: 'Arjun',
    repository,
  });
  const first = await finalizePrompt({
    slug: room.slug,
    content: 'Initial QA Prompt body',
    name: 'Initial QA Prompt',
    finalizedBy: 'Arjun',
    repository,
  });
  assert.equal(first.version, 1);
  assert.equal(first.name, 'Initial QA Prompt');
  assert.equal(first.prompt, 'Initial QA Prompt body');

  await persistPromptSnapshot({
    slug: room.slug,
    content: 'Diverged draft after finalize',
    repository,
  });
  const ws = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(ws.draft, 'Diverged draft after finalize');
  assert.equal(ws.versions[0].prompt, 'Initial QA Prompt body');
  assert.equal(ws.versions[0].name, 'Initial QA Prompt');
});

test('blank version name falls back to Version N', async (t) => {
  const { room, repository } = await seedRoom(t);
  await persistPromptSnapshot({ slug: room.slug, content: 'x', repository });
  const result = await finalizePrompt({
    slug: room.slug,
    content: 'x',
    name: '   ',
    finalizedBy: 'Akshay',
    repository,
  });
  assert.equal(result.name, 'Version 1');
});

test('historical versions are immutable; concurrent finalize gets unique numbers', async (t) => {
  const { room, repository } = await seedRoom(t);
  await persistPromptSnapshot({ slug: room.slug, content: 'Shared concurrent draft', repository });

  const [a, b] = await Promise.all([
    finalizePrompt({
      slug: room.slug,
      content: 'Shared concurrent draft',
      name: 'A',
      finalizedBy: 'A',
      repository,
    }),
    finalizePrompt({
      slug: room.slug,
      content: 'Shared concurrent draft',
      name: 'B',
      finalizedBy: 'B',
      repository,
    }),
  ]);
  const versions = new Set([a.version, b.version]);
  assert.equal(versions.size, 2);
  assert.deepEqual([...versions].sort((x, y) => x - y), [1, 2]);

  const ws = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(ws.versions.length, 2);
  assert.equal(ws.versions[0].prompt, 'Shared concurrent draft');
  assert.equal(ws.versions[1].prompt, 'Shared concurrent draft');
});

test('locked prompt rejects writes and finalize; unlock restores', async (t) => {
  const { room, repository, ownerId } = await seedRoom(t);
  await persistPromptSnapshot({ slug: room.slug, content: 'hello', repository });
  await finalizePrompt({
    slug: room.slug,
    content: 'hello',
    name: 'Keep',
    finalizedBy: 'Alice',
    repository,
  });
  await setPromptLock({ room, ownerId, locked: true, repository });

  await assert.rejects(
    () => persistPromptSnapshot({ slug: room.slug, content: 'nope', repository }),
    (err) => err instanceof PromptError && err.code === 'PROMPT_LOCKED',
  );
  await assert.rejects(
    () => finalizePrompt({ slug: room.slug, content: 'nope', repository }),
    (err) => err instanceof PromptError && err.code === 'PROMPT_LOCKED',
  );

  const lockedView = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(lockedView.locked, true);
  assert.equal(lockedView.versions[0].prompt, 'hello');

  await setPromptLock({ room, ownerId, locked: false, repository });
  const after = await persistPromptSnapshot({ slug: room.slug, content: 'again', repository });
  assert.equal(after.draft, 'again');
  assert.equal(after.locked, false);
});

test('ended room rejects writes; versions remain readable', async (t) => {
  const { room, repository, ownerId } = await seedRoom(t);
  await persistPromptSnapshot({ slug: room.slug, content: 'keep me', repository });
  await finalizePrompt({
    slug: room.slug,
    content: 'keep me',
    name: 'Final',
    finalizedBy: 'Owner',
    repository,
  });
  await endRoom({
    room,
    ownerId,
    repository,
    livekitRooms: {
      async deleteRoom() { return true; },
    },
  });

  await assert.rejects(
    () => putPromptDraft({ slug: room.slug, draft: 'blocked', repository }),
    (err) => err instanceof PromptError && err.code === 'ROOM_ENDED',
  );
  const ws = await getPromptWorkspace({ slug: room.slug, repository });
  assert.equal(ws.roomStatus, 'ended');
  assert.equal(ws.readOnly, true);
  assert.equal(ws.versions[0].prompt, 'keep me');
});

test('expired room rejects writes', async (t) => {
  let clock = Date.parse('2026-09-22T12:00:00.000Z');
  const { room, repository } = await seedRoom(t, {
    now: () => clock,
    expiresAt: new Date(clock + 60_000).toISOString(),
  });
  await persistPromptSnapshot({
    slug: room.slug,
    content: 'before',
    repository,
    now: () => clock,
  });
  clock += 61_000;
  await assert.rejects(
    () => persistPromptSnapshot({
      slug: room.slug,
      content: 'after',
      repository,
      now: () => clock,
    }),
    (err) => err instanceof PromptError && err.code === 'ROOM_EXPIRED',
  );
});

test('room A snapshot does not affect room B', async (t) => {
  const a = await seedRoom(t, { title: 'Room A' });
  const b = await seedRoom(t, { title: 'Room B', repository: a.repository });
  await persistPromptSnapshot({
    slug: a.room.slug,
    content: 'Only A',
    repository: a.repository,
  });
  await persistPromptSnapshot({
    slug: b.room.slug,
    content: 'Only B',
    repository: a.repository,
  });
  const wa = await getPromptWorkspace({ slug: a.room.slug, repository: a.repository });
  const wb = await getPromptWorkspace({ slug: b.room.slug, repository: a.repository });
  assert.equal(wa.draft, 'Only A');
  assert.equal(wb.draft, 'Only B');
});

test('CRDT merge then finalize uses merged shared state', async (t) => {
  const { room, repository } = await seedRoom(t);
  const peerA = createPromptDoc();
  const peerB = createPromptDoc();
  applyLocalTextDiff(peerA.ytext, 'Review the project');
  mergeDocs(peerA.doc, peerB.doc);
  applyLocalTextDiff(peerA.ytext, 'Review carefully the project');
  applyLocalTextDiff(peerB.ytext, 'Review the project for security');
  mergeDocs(peerA.doc, peerB.doc);
  const content = getPromptText(peerA.doc);

  await persistPromptSnapshot({ slug: room.slug, content, repository });
  const finalized = await finalizePrompt({
    slug: room.slug,
    content,
    name: 'Security Review',
    finalizedBy: 'Arjun',
    repository,
  });
  assert.match(finalized.prompt, /carefully/);
  assert.match(finalized.prompt, /for security/);
  assert.equal(finalized.name, 'Security Review');
});

test('character count matches shared text length', async (t) => {
  const { room, repository } = await seedRoom(t);
  const content = 'Copy me please';
  const snap = await persistPromptSnapshot({ slug: room.slug, content, repository });
  assert.equal(snap.draft.length, content.length);
  assert.equal(snap.draft, content);
});
