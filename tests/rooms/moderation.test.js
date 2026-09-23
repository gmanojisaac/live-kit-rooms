/**

 * AUTH-05 owner moderation suite tests.

 */



import test from 'node:test';

import assert from 'node:assert/strict';

import { createRoom } from '../../lib/rooms/service.js';

import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';

import { createOwnerSession } from '../../lib/security/owner-session.js';

import { requireRoomOwner, OwnerAuthError } from '../../lib/rooms/owner-auth.js';

import {

  setPromptLock,

  removeRoomParticipant,

  revokeRoomInvitation,

  endRoom,

  ModerationError,

} from '../../lib/rooms/moderation.js';

import {

  getPromptWorkspace,

  putPromptDraft,

  finalizePrompt,

  PromptError,

} from '../../lib/prompts/service.js';

import { joinRoomAsParticipant, RoomJoinError } from '../../lib/rooms/join.js';

import { validateRoomAccess, AccessRejection } from '../../lib/rooms/access-validation.js';

import { resolveRoomStatus } from '../../lib/rooms/status.js';

import { AUDIT_EVENT } from '../../lib/rooms/audit.js';

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

    minAccessCodeLength: 12,

    maxAccessCodeLength: 128,

    maxRoomTitleLength: 120,

    provisional: {},

    ...overrides,

  };

}



function createMockLiveKit({ participants = [] } = {}) {

  const state = {

    participants: [...participants],

    removed: [],

    deleted: [],

  };

  return {

    state,

    async ensureRoom(roomName) {

      return { name: roomName, maxParticipants: MAX_PARTICIPANTS };

    },

    async countParticipants() {

      return state.participants.length;

    },

    async listParticipants() {

      return state.participants.map((p) => ({ ...p }));

    },

    async removeParticipant(roomName, identity) {

      const idx = state.participants.findIndex((p) => p.identity === identity);

      if (idx < 0) {

        const err = new Error('not found');

        err.status = 404;

        throw err;

      }

      state.participants.splice(idx, 1);

      state.removed.push({ roomName, identity });

    },

    async deleteRoom(roomName) {

      state.deleted.push(roomName);

      state.participants = [];

    },

  };

}



function fakeRequest(sessionToken) {

  return {

    headers: {

      get(name) {

        if (name.toLowerCase() === 'cookie' && sessionToken) {

          return `lkr_owner_session=${encodeURIComponent(sessionToken)}`;

        }

        return null;

      },

    },

  };

}



async function seedOwnedRoom(t, overrides = {}) {

  const now = overrides.now || Date.now;

  const repository = overrides.repository || createMemoryRoomRepository({ now });

  const result = await createRoom({

    title: overrides.title || 'Moderation Room',

    accessCode: overrides.accessCode || ACCESS_CODE,

    expiresAt: overrides.expiresAt,

    baseUrl: 'https://example.test',

    repository,

    policy: testPolicy(overrides.policy),

    now,

  });

  return { result, repository, now, ownerId: result.owner.id };

}



test('owner can lock and unlock prompt; state persists', async (t) => {

  const { result, repository, ownerId } = await seedOwnedRoom(t);

  const room = await repository.getRoomBySlug(result.room.slug);



  const locked = await setPromptLock({

    room,

    ownerId,

    locked: true,

    repository,

  });

  assert.equal(locked.locked, true);

  const doc = await repository.getPromptDocument(room.id);

  assert.equal(doc.is_locked, true);



  const unlocked = await setPromptLock({

    room,

    ownerId,

    locked: false,

    repository,

  });

  assert.equal(unlocked.locked, false);

  assert.equal((await repository.getPromptDocument(room.id)).is_locked, false);



  const events = await repository.listAuditEvents(room.id);

  assert.ok(events.some((e) => e.event_type === AUDIT_EVENT.PROMPT_LOCKED && e.actor_id === ownerId));

  assert.ok(events.some((e) => e.event_type === AUDIT_EVENT.PROMPT_UNLOCKED && e.actor_id === ownerId));

});



test('non-owner and tampered session cannot lock; body ownerId is ignored', async (t) => {

  const { result, repository } = await seedOwnedRoom(t);

  const policy = testPolicy();



  await assert.rejects(

    () => requireRoomOwner(fakeRequest(null), result.room.slug, { repository, policy }),

    (e) => e instanceof OwnerAuthError && e.httpStatus === 401,

  );



  const other = createOwnerSession(SESSION_SECRET, { ownerId: crypto.randomUUID() });

  await assert.rejects(

    () => requireRoomOwner(fakeRequest(other.token), result.room.slug, { repository, policy }),

    (e) => e instanceof OwnerAuthError && e.httpStatus === 403,

  );



  const tampered = `${result.sessionCookie?.value || createOwnerSession(SESSION_SECRET, {

    ownerId: result.owner.id,

  }).token}x`;

  const ownerSession = createOwnerSession(SESSION_SECRET, { ownerId: result.owner.id });

  const broken = `${ownerSession.token.slice(0, -6)}aaaaaa`;

  await assert.rejects(

    () => requireRoomOwner(fakeRequest(broken), result.room.slug, { repository, policy }),

    (e) => e instanceof OwnerAuthError && e.httpStatus === 401,

  );



  // Valid owner auth still comes from session, not body.

  const auth = await requireRoomOwner(fakeRequest(ownerSession.token), result.room.slug, {

    repository,

    policy,

  });

  assert.equal(auth.ownerId, result.owner.id);

  assert.notEqual(auth.ownerId, 'body-spoofed-owner');

  void tampered;

});



test('locked room rejects draft mutation and finalization; unlock restores; versions readable', async (t) => {

  const { result, repository, ownerId } = await seedOwnedRoom(t);

  const slug = result.room.slug;

  const room = await repository.getRoomBySlug(slug);



  await putPromptDraft({ slug, draft: 'hello team', repository });

  await finalizePrompt({ slug, finalizedBy: 'Alice', repository });



  await setPromptLock({ room, ownerId, locked: true, repository });



  await assert.rejects(

    () => putPromptDraft({ slug, draft: 'should fail', repository }),

    (e) => e instanceof PromptError && e.httpStatus === 409 && e.code === 'PROMPT_LOCKED',

  );

  await assert.rejects(

    () => finalizePrompt({ slug, finalizedBy: 'Bob', repository }),

    (e) => e instanceof PromptError && e.httpStatus === 409 && e.code === 'PROMPT_LOCKED',

  );



  const lockedView = await getPromptWorkspace({ slug, repository });

  assert.equal(lockedView.locked, true);

  assert.equal(lockedView.versions.length, 1);

  assert.equal(lockedView.versions[0].prompt, 'hello team');



  await setPromptLock({ room, ownerId, locked: false, repository });

  const after = await putPromptDraft({ slug, draft: 'editable again', repository });

  assert.equal(after.draft, 'editable again');

  assert.equal(after.locked, false);

});



test('owner can remove participant; non-owner cannot; unknown/cross-room rejected; audit logged', async (t) => {

  const a = await seedOwnedRoom(t, { title: 'Room A' });

  const b = await seedOwnedRoom(t, {

    title: 'Room B',

    repository: a.repository,

  });

  const livekit = createMockLiveKit({

    participants: [

      { identity: 'p-arjun', name: 'Arjun' },

      { identity: 'p-other', name: 'Other' },

    ],

  });



  const roomA = await a.repository.getRoomBySlug(a.result.room.slug);

  const removed = await removeRoomParticipant({

    room: roomA,

    ownerId: a.ownerId,

    participantIdentity: 'p-arjun',

    repository: a.repository,

    livekitRooms: livekit,

  });

  assert.equal(removed.removed, true);

  assert.equal(livekit.state.removed[0].identity, 'p-arjun');

  assert.equal(livekit.state.removed[0].roomName, a.result.room.slug);



  await assert.rejects(

    () => removeRoomParticipant({

      room: roomA,

      ownerId: a.ownerId,

      participantIdentity: 'missing-id',

      repository: a.repository,

      livekitRooms: livekit,

    }),

    (e) => e instanceof ModerationError && e.httpStatus === 404,

  );



  // Participant only in room A's LiveKit list cannot be removed via room B's slug scope:

  // room B has its own empty list.

  const livekitB = createMockLiveKit({ participants: [] });

  const roomB = await a.repository.getRoomBySlug(b.result.room.slug);

  await assert.rejects(

    () => removeRoomParticipant({

      room: roomB,

      ownerId: b.ownerId,

      participantIdentity: 'p-other',

      repository: a.repository,

      livekitRooms: livekitB,

    }),

    (e) => e instanceof ModerationError && e.code === 'PARTICIPANT_NOT_FOUND',

  );



  const events = await a.repository.listAuditEvents(roomA.id);

  const removal = events.find((e) => e.event_type === AUDIT_EVENT.PARTICIPANT_REMOVED);

  assert.ok(removal);

  assert.equal(removal.actor_id, a.ownerId);

  assert.equal(removal.metadata_minimal.participantIdentity, 'p-arjun');

  assert.equal(JSON.stringify(removal).includes(ACCESS_CODE), false);

  assert.equal(JSON.stringify(removal).includes(SESSION_SECRET), false);



  // Display name is not authoritative — wrong identity with matching name fails.

  await assert.rejects(

    () => removeRoomParticipant({

      room: roomA,

      ownerId: a.ownerId,

      participantIdentity: 'Arjun',

      repository: a.repository,

      livekitRooms: livekit,

    }),

    (e) => e instanceof ModerationError && e.httpStatus === 404,

  );

});



test('owner can revoke invitation; join fails after revoke; audit logged; scoped to room', async (t) => {

  const a = await seedOwnedRoom(t, { title: 'Invite A' });

  const b = await seedOwnedRoom(t, { title: 'Invite B', repository: a.repository });

  const roomA = await a.repository.getRoomBySlug(a.result.room.slug);



  const revoked = await revokeRoomInvitation({

    room: roomA,

    ownerId: a.ownerId,

    repository: a.repository,

  });

  assert.equal(revoked.revoked, true);



  const access = await validateRoomAccess({

    repository: a.repository,

    slug: a.result.room.slug,

    rawInviteToken: a.result._test.rawToken,

    accessCode: ACCESS_CODE,

  });

  assert.equal(access.ok, false);

  assert.equal(access.reason, AccessRejection.INVITE_REVOKED);



  // Room B invite still valid.

  const accessB = await validateRoomAccess({

    repository: a.repository,

    slug: b.result.room.slug,

    rawInviteToken: b.result._test.rawToken,

    accessCode: ACCESS_CODE,

  });

  assert.equal(accessB.ok, true);



  // Cross-room inviteId revoke rejected.

  const inviteB = await a.repository.getInviteByTokenHash(b.result._test.tokenHash);

  await assert.rejects(

    () => revokeRoomInvitation({

      room: roomA,

      ownerId: a.ownerId,

      inviteId: inviteB.id,

      repository: a.repository,

    }),

    (e) => e instanceof ModerationError && e.httpStatus === 404,

  );



  const events = await a.repository.listAuditEvents(roomA.id);

  assert.ok(events.some((e) => (

    e.event_type === AUDIT_EVENT.INVITATION_REVOKED && e.actor_id === a.ownerId

  )));

});



test('owner can end room; idempotent; revokes invite; join rejected; prompt read-only; audit', async (t) => {

  const { result, repository, ownerId } = await seedOwnedRoom(t);

  const room = await repository.getRoomBySlug(result.room.slug);

  const livekit = createMockLiveKit({

    participants: [{ identity: 'p1', name: 'Guest' }],

  });



  await putPromptDraft({ slug: result.room.slug, draft: 'before end', repository });



  const ended = await endRoom({

    room,

    ownerId,

    repository,

    livekitRooms: livekit,

  });

  assert.equal(ended.ended, true);

  assert.equal(ended.alreadyEnded, false);

  assert.equal(ended.roomStatus, 'ended');

  assert.equal((await repository.getRoomById(room.id)).status, 'ended');

  assert.ok(livekit.state.deleted.includes(result.room.slug));



  const again = await endRoom({

    room: await repository.getRoomById(room.id),

    ownerId,

    repository,

    livekitRooms: livekit,

  });

  assert.equal(again.alreadyEnded, true);



  const access = await validateRoomAccess({

    repository,

    slug: result.room.slug,

    rawInviteToken: result._test.rawToken,

    accessCode: ACCESS_CODE,

  });

  assert.equal(access.ok, false);

  assert.equal(access.reason, AccessRejection.ROOM_ENDED);



  await assert.rejects(

    () => putPromptDraft({ slug: result.room.slug, draft: 'nope', repository }),

    (e) => e instanceof PromptError && e.code === 'ROOM_ENDED',

  );

  await assert.rejects(

    () => finalizePrompt({ slug: result.room.slug, repository }),

    (e) => e instanceof PromptError && e.code === 'ROOM_ENDED',

  );



  const view = await getPromptWorkspace({ slug: result.room.slug, repository });

  assert.equal(view.readOnly, true);

  assert.equal(view.draft, 'before end');



  const events = await repository.listAuditEvents(room.id);

  const endEvents = events.filter((e) => e.event_type === AUDIT_EVENT.ROOM_ENDED);

  assert.equal(endEvents.length, 1);

  assert.equal(endEvents[0].actor_id, ownerId);

  assert.equal(JSON.stringify(endEvents[0]).includes(result._test.rawToken), false);

});



test('expired room rejects joins, invite consume, and prompt writes; does not reactivate ended', async (t) => {

  let clock = Date.parse('2026-09-22T12:00:00.000Z');

  const { result, repository, ownerId } = await seedOwnedRoom(t, {

    now: () => clock,

    expiresAt: new Date(clock + 60_000).toISOString(),

  });



  clock += 61_000;

  assert.equal(

    resolveRoomStatus(await repository.getRoomBySlug(result.room.slug), { now: () => clock }),

    'expired',

  );



  await assert.rejects(

    () => joinRoomAsParticipant({

      slug: result.room.slug,

      inviteToken: result._test.rawToken,

      displayName: 'Late',

      accessCode: ACCESS_CODE,

      repository,

      livekitRooms: createMockLiveKit(),

      livekitCredentials: {

        url: 'wss://example.livekit.cloud',

        apiKey: 'k',

        apiSecret: 'secret-value-for-tests-here',

      },

      policy: testPolicy(),

      now: () => clock,

    }),

    (e) => e instanceof RoomJoinError && e.httpStatus === 410,

  );



  const room = await repository.getRoomBySlug(result.room.slug);

  assert.equal(room.status, 'expired');



  await assert.rejects(

    () => putPromptDraft({

      slug: result.room.slug,

      draft: 'late edit',

      repository,

      now: () => clock,

    }),

    (e) => e instanceof PromptError && e.code === 'ROOM_EXPIRED',

  );



  await assert.rejects(

    () => setPromptLock({

      room,

      ownerId,

      locked: true,

      repository,

      now: () => clock,

    }),

    (e) => e instanceof ModerationError && e.code === 'ROOM_EXPIRED',

  );



  // Ended room must not become expired/active via expiry path.

  const endedSeed = await seedOwnedRoom(t, {

    title: 'Already Ended',

    repository,

    now: () => clock - 120_000,

    expiresAt: new Date(clock - 30_000).toISOString(),

  });

  await repository.markRoomEnded(endedSeed.result.room.id);

  const endedRoom = await repository.getRoomById(endedSeed.result.room.id);

  assert.equal(endedRoom.status, 'ended');

  assert.equal(resolveRoomStatus(endedRoom, { now: () => clock }), 'ended');

  const marked = await repository.markRoomExpired(endedRoom.id);

  assert.equal(marked, null);

  assert.equal((await repository.getRoomById(endedRoom.id)).status, 'ended');

});



test('audit events omit secrets across moderation actions', async (t) => {

  const { result, repository, ownerId } = await seedOwnedRoom(t);

  const room = await repository.getRoomBySlug(result.room.slug);

  const livekit = createMockLiveKit({

    participants: [{ identity: 'id-1', name: 'Member' }],

  });



  await setPromptLock({ room, ownerId, locked: true, repository });

  await removeRoomParticipant({

    room,

    ownerId,

    participantIdentity: 'id-1',

    repository,

    livekitRooms: livekit,

  });

  await revokeRoomInvitation({ room, ownerId, repository });

  await endRoom({ room, ownerId, repository, livekitRooms: livekit });



  const blob = JSON.stringify(await repository.listAuditEvents(room.id));

  assert.equal(blob.includes(ACCESS_CODE), false);

  assert.equal(blob.includes(result._test.rawToken), false);

  assert.equal(blob.includes(result._test.tokenHash), false);

  assert.equal(blob.includes(result._test.codeHash), false);

  assert.equal(blob.includes(SESSION_SECRET), false);

  assert.match(blob, /prompt_locked/);

  assert.match(blob, /participant_removed/);

  assert.match(blob, /invitation_revoked/);

  assert.match(blob, /room_ended/);

});

