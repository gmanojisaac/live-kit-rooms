import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRoomRepository } from '../../lib/rooms/repository.js';
import { generateRoomSlug } from '../../lib/rooms/slug.js';
import {
  createRun,
  listRuns,
  getRun,
  getRunImage,
  RunError,
} from '../../lib/runs/service.js';

const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
const TEAM = ['Asha', 'Ravi', 'Kiran'];

async function seedRoom() {
  let tick = Date.parse('2026-10-02T09:00:00.000Z');
  const repository = createMemoryRoomRepository({ now: () => { tick += 1000; return tick; } });
  const room = await repository.insertRoom({
    slug: generateRoomSlug(),
    title: 'Team room',
    owner_id: null,
    code_hash: 'x',
    status: 'active',
    max_participants: 6,
    expires_at: null,
  });
  await repository.insertPromptVersion({
    room_id: room.id,
    version_number: 1,
    name: 'Version 1',
    content: 'Draw a lighthouse.',
    created_by: 'Ravi',
  });
  return { repository, room, slug: room.slug };
}

test('prompt run is stored durably with its prompt snapshot and JPEG', async () => {
  const { repository, slug } = await seedRoom();
  const run = await createRun({
    slug,
    kind: 'run',
    promptVersion: 1,
    status: 'success',
    notes: 'looks right',
    executedBy: 'asha',
    jpeg: JPEG,
    teamMembers: TEAM,
    repository,
  });

  assert.equal(run.kind, 'run');
  assert.equal(run.promptVersion, 1);
  assert.equal(run.promptSnapshot, 'Draw a lighthouse.');
  assert.equal(run.executedBy, 'Asha', 'name is canonicalized to the roster spelling');
  assert.equal(run.imageUrl, `/api/rooms/${slug}/runs/${run.id}/image`);

  const fetched = await getRun({ slug, runId: run.id, repository });
  assert.equal(fetched.notes, 'looks right');
  const image = await getRunImage({ slug, runId: run.id, repository });
  assert.deepEqual(image, JPEG);
});

test('work progress upload needs no prompt version or status', async () => {
  const { repository, slug } = await seedRoom();
  const entry = await createRun({
    slug,
    kind: 'progress',
    executedBy: 'Kiran',
    jpeg: JPEG,
    teamMembers: TEAM,
    repository,
  });
  assert.equal(entry.kind, 'progress');
  assert.equal(entry.promptVersion, null);
  assert.equal(entry.status, null);
});

test('history lists newest first and filters by team member', async () => {
  const { repository, slug } = await seedRoom();
  const base = { slug, jpeg: JPEG, teamMembers: TEAM, repository };
  const first = await createRun({ ...base, kind: 'progress', executedBy: 'Asha' });
  const second = await createRun({ ...base, kind: 'run', promptVersion: 1, status: 'failure', executedBy: 'Ravi' });
  const third = await createRun({ ...base, kind: 'progress', executedBy: 'Asha' });

  const all = await listRuns({ slug, repository });
  assert.deepEqual(all.map((run) => run.id), [third.id, second.id, first.id]);

  const asha = await listRuns({ slug, executedBy: 'Asha', repository });
  assert.deepEqual(asha.map((run) => run.id), [third.id, first.id]);
});

test('rejects invalid entries without leaving data behind', async () => {
  const { repository, slug } = await seedRoom();
  const base = { slug, jpeg: JPEG, teamMembers: TEAM, repository };
  const rejects = (args, code) => assert.rejects(
    () => createRun({ ...base, ...args }),
    (error) => error instanceof RunError && error.code === code,
  );

  await rejects({ kind: 'run', promptVersion: 1, status: 'success', executedBy: 'Stranger' }, 'NOT_A_TEAM_MEMBER');
  await rejects({ kind: 'run', promptVersion: 9, status: 'success', executedBy: 'Asha' }, 'VERSION_NOT_FOUND');
  await rejects({ kind: 'run', promptVersion: 1, status: 'maybe', executedBy: 'Asha' }, 'INVALID_STATUS');
  await rejects({ kind: 'run', status: 'success', executedBy: 'Asha' }, 'INVALID_VERSION');
  await rejects({ kind: 'progress', executedBy: 'Asha', jpeg: Buffer.alloc(0) }, 'MISSING_JPEG');
  await rejects({ kind: 'progress', executedBy: 'Asha', notes: 'x'.repeat(2001) }, 'NOTES_TOO_LONG');
  await rejects({ kind: 'progress', executedBy: 'Asha', slug: 'no-such-room' }, 'ROOM_NOT_FOUND');

  assert.deepEqual(await listRuns({ slug, repository }), []);
});

test('JPEG is removed when the metadata insert fails', async () => {
  const { repository, slug } = await seedRoom();
  const uploaded = [];
  const removed = [];
  const failing = {
    ...repository,
    uploadRunImage: async (path) => { uploaded.push(path); },
    removeRunImage: async (path) => { removed.push(path); },
    insertRun: async () => { throw new Error('db down'); },
  };
  await assert.rejects(() => createRun({
    slug, kind: 'progress', executedBy: 'Asha', jpeg: JPEG, repository: failing,
  }), /db down/);
  assert.equal(uploaded.length, 1);
  assert.deepEqual(removed, uploaded);
});

test('runs are scoped to their room and unknown ids are 404', async () => {
  const a = await seedRoom();
  const b = await seedRoom();
  const run = await createRun({
    slug: a.slug, kind: 'progress', executedBy: 'Guest', jpeg: JPEG, repository: a.repository,
  });
  assert.equal(run.executedBy, 'Guest', 'free-form names are allowed without a roster');

  const notFound = (args) => assert.rejects(
    () => getRun(args),
    (error) => error instanceof RunError && error.httpStatus === 404,
  );
  await notFound({ slug: b.slug, runId: run.id, repository: b.repository });
  await notFound({ slug: a.slug, runId: 'not-a-uuid', repository: a.repository });
});
