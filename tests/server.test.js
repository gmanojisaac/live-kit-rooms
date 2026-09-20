import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp, MAX_PARTICIPANTS, ROOM_NAME } from '../server/app.js';

const config = {
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-only-for-automated-tests',
  ROOM_ACCESS_CODE: 'unchanged-test-access-code',
};

async function fixture(t, overrides = {}, settings = config, appOptions = {}) {
  const calls = [];
  const service = {
    listRooms: async () => [],
    removeParticipant: async () => {},
    createRoom: async options => { calls.push(options); return options; },
    listParticipants: async () => [],
    ...overrides,
  };
  const server = createApp({ config: settings, roomService: service, logger: { error() {} }, ...appOptions }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const join = (body = { name: 'Same name', accessCode: config.ROOM_ACCESS_CODE }) => fetch(
    'http://127.0.0.1:' + server.address().port + '/api/join',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const leave = (data) => fetch('http://127.0.0.1:' + server.address().port + '/api/leave', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  return { join, leave, calls };
}

test('same code and same display name produce separately signed identities in the same capped room', async t => {
  const { join, calls } = await fixture(t);
  const responses = await Promise.all([join(), join()]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const bodies = await Promise.all(responses.map(response => response.json()));
  const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  const claims = await Promise.all(bodies.map(body => verifier.verify(body.token)));
  assert.notEqual(claims[0].sub, claims[1].sub);
  for (const claim of claims) {
    assert.equal(claim.video.room, ROOM_NAME);
    assert.equal(claim.video.canPublish, true);
    assert.equal(claim.video.canSubscribe, true);
    assert.equal(claim.video.canPublishData, true);
    assert.equal(claim.roomConfig.maxParticipants, MAX_PARTICIPANTS);
  }
  assert.ok(calls.every(call => call.maxParticipants === MAX_PARTICIPANTS));
  assert.ok(bodies.every(body => !JSON.stringify(body).includes(config.LIVEKIT_API_SECRET)));
  assert.ok(bodies.every(body => !JSON.stringify(body).includes(config.ROOM_ACCESS_CODE)));
});

test('rejects a join when the room is full and allows a replacement after one leaves', async t => {
  let count = MAX_PARTICIPANTS;
  const { join } = await fixture(t, { listParticipants: async () => Array.from({ length: count }, (_, i) => ({ identity: String(i) })) });
  assert.equal((await join()).status, 409);
  count = MAX_PARTICIPANTS - 1;
  assert.equal((await join()).status, 200);
});

test('rejects incorrect codes and invalid names without contacting LiveKit', async t => {
  const fail = async () => { throw new Error('Should not contact LiveKit'); };
  const { join } = await fixture(t, { listRooms: fail });
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  assert.equal((await join({ name: '   ', accessCode: config.ROOM_ACCESS_CODE })).status, 400);
  assert.equal((await join({ name: 'x'.repeat(41), accessCode: config.ROOM_ACCESS_CODE })).status, 400);
});

test('missing configuration and LiveKit failures fail closed', async t => {
  const missing = await fixture(t, {}, {});
  assert.equal((await missing.join()).status, 503);
  const unavailable = await fixture(t, { listParticipants: async () => { throw new Error('Unavailable'); } });
  assert.equal((await unavailable.join()).status, 502);
  const uncapped = await fixture(t, { createRoom: async () => ({ maxParticipants: 0 }) });
  assert.equal((await uncapped.join()).status, 502);
});

test('does not issue tokens for or delete an older unlimited room', async t => {
  const { join, calls } = await fixture(t, { listRooms: async () => [{ name: ROOM_NAME, maxParticipants: 0 }] });
  assert.equal((await join()).status, 409);
  assert.equal(calls.length, 0);
});
test('simultaneous requests reserve exactly the max seats before anyone connects', async t => {
  const { join } = await fixture(t);
  const results = await Promise.all(Array.from({ length: MAX_PARTICIPANTS + 1 }, () => join()));
  assert.deepEqual(
    results.map(response => response.status).sort(),
    [...Array(MAX_PARTICIPANTS).fill(200), 409],
  );
});

test('only the holder can release a seat, and revocation completes before replacement admission', async t => {
  const revoked = [];
  const { join, leave } = await fixture(t, { removeParticipant: async (_room, identity) => { revoked.push(identity); } });
  const first = await (await join()).json();
  for (let i = 1; i < MAX_PARTICIPANTS; i++) await join();
  assert.equal((await leave({ identity: first.identity, leaveKey: 'wrong' })).status, 403);
  assert.equal((await join()).status, 409);
  assert.equal((await leave({ identity: first.identity, leaveKey: first.leaveKey })).status, 204);
  assert.deepEqual(revoked, [first.identity]);
  const replacement = await join();
  assert.equal(replacement.status, 200);
  assert.notEqual((await replacement.json()).identity, first.identity);
});

test('abandoned reservations expire only after revocation; active participants keep their seats', async t => {
  let clock = 1_000_000;
  const revoked = [];
  let active = [];
  const { join } = await fixture(t, {
    listParticipants: async () => active,
    removeParticipant: async (_room, identity) => { revoked.push(identity); },
  }, config, { now: () => clock });
  const first = await (await join()).json();
  const second = await (await join()).json();
  active = [{ identity: first.identity }];
  clock += 120_001;
  assert.equal((await join()).status, 200);
  assert.deepEqual(revoked, [second.identity]);
});

test('revocation failure cannot free a reserved seat', async t => {
  const { join, leave } = await fixture(t, { removeParticipant: async () => { throw new Error('Offline'); } });
  const first = await (await join()).json();
  for (let i = 1; i < MAX_PARTICIPANTS; i++) await join();
  assert.equal((await leave({ identity: first.identity, leaveKey: first.leaveKey })).status, 502);
  assert.equal((await join()).status, 409);
});


test('outstanding reservations survive a server restart', async t => {
  const { mkdtempSync, rmSync, rmdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createAdmissionStore } = await import('../server/admissions.js');
  const directory = mkdtempSync(path.join(tmpdir(), 'livekit-admission-test-'));
  const file = path.join(directory, 'admissions.json');
  t.after(() => { rmSync(file, { force: true }); rmdirSync(directory); });
  const firstServer = await fixture(t, {}, config, { admissions: createAdmissionStore(file) });
  for (let i = 0; i < MAX_PARTICIPANTS; i++) await firstServer.join();
  const restartedServer = await fixture(t, {}, config, { admissions: createAdmissionStore(file) });
  assert.equal((await restartedServer.join()).status, 409);
});
