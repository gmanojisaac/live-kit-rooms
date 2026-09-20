import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  createApp, MAX_PARTICIPANTS, RESERVATION_TTL_MS, ROOM_NAME, MAX_PROMPT_LENGTH, MAX_JPEG_BYTES,
  JOIN_RATE_LIMIT_MAX_FAILURES, JOIN_RATE_LIMIT_WINDOW_MS, createJoinRateLimiter, normalizeIp,
  createClientIpResolver, parseTrustedProxyIps,
} from '../server/app.js';
import { createPromptStore } from '../server/prompts.js';
import { createRunStore } from '../server/runs.js';

const config = {
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-only-for-automated-tests',
  ROOM_ACCESS_CODE: 'unchanged-test-access-code',
};

function sampleJpeg(extraBytes = 0) {
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(extraBytes, 0x00)]);
}

function jpegPayload(buffer = sampleJpeg()) {
  return {
    contentType: 'image/jpeg',
    jpegBase64: buffer.toString('base64'),
  };
}

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
  const base = 'http://127.0.0.1:' + server.address().port;
  const join = (body = { name: 'Same name', accessCode: config.ROOM_ACCESS_CODE }) => fetch(
    base + '/api/join',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const leave = (data) => fetch(base + '/api/leave', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const promptHeaders = (seat) => ({
    'content-type': 'application/json',
    'x-participant-identity': seat.identity,
    'x-leave-key': seat.leaveKey,
  });
  const getPrompt = (seat, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/prompt',
    { headers: promptHeaders(seat) },
  );
  const putPrompt = (seat, draft, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/prompt',
    { method: 'PUT', headers: promptHeaders(seat), body: JSON.stringify({ draft }) },
  );
  const finalizePrompt = (seat, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/prompt/finalize',
    { method: 'POST', headers: promptHeaders(seat), body: '{}' },
  );
  const listRuns = (seat, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/runs',
    { headers: promptHeaders(seat) },
  );
  const createRun = (seat, body, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/runs',
    { method: 'POST', headers: promptHeaders(seat), body: JSON.stringify(body) },
  );
  const getRun = (seat, runId, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/runs/' + encodeURIComponent(runId),
    { headers: promptHeaders(seat) },
  );
  const getRunImage = (seat, runId, room = seat.roomName) => fetch(
    base + '/api/rooms/' + encodeURIComponent(room) + '/runs/' + encodeURIComponent(runId) + '/image',
    { headers: promptHeaders(seat) },
  );
  return {
    join, leave, calls, getPrompt, putPrompt, finalizePrompt,
    listRuns, createRun, getRun, getRunImage, base,
  };
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

test('join token absolute expiry matches the reservation pendingUntil', async t => {
  const { createAdmissionStore } = await import('../server/admissions.js');
  const admissions = createAdmissionStore();
  const { join } = await fixture(t, {}, config, { admissions });
  const body = await (await join()).json();
  const reservation = admissions.entries.get(body.identity);
  assert.ok(reservation);
  const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET).verify(body.token);
  assert.equal(claims.exp, Math.floor(reservation.pendingUntil / 1000));
  assert.ok(claims.exp * 1000 <= reservation.pendingUntil);
  assert.notEqual(claims.exp - claims.nbf, 10 * 60);
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

test('abandoned reservations expire only after the shared TTL; active participants keep their seats', async t => {
  let clock = 1_000_000;
  const revoked = [];
  let active = [];
  const { join } = await fixture(t, {
    listParticipants: async () => active,
    removeParticipant: async (_room, identity) => { revoked.push(identity); },
  }, config, { now: () => clock });
  const seats = [];
  for (let i = 0; i < MAX_PARTICIPANTS; i++) seats.push(await (await join()).json());
  active = [{ identity: seats[0].identity }];
  clock += RESERVATION_TTL_MS - 1;
  assert.equal((await join()).status, 409);
  assert.deepEqual(revoked, []);
  clock += 1;
  assert.equal((await join()).status, 200);
  assert.deepEqual(revoked, seats.slice(1).map(seat => seat.identity));
});

test('token absolute expiry does not outlive the reservation window', async t => {
  let clock = 5_000_000;
  const { createAdmissionStore } = await import('../server/admissions.js');
  const admissions = createAdmissionStore();
  const { join } = await fixture(t, {}, config, { now: () => clock, admissions });
  const body = await (await join()).json();
  const reservation = admissions.entries.get(body.identity);
  assert.ok(reservation);
  assert.equal(reservation.pendingUntil - clock, RESERVATION_TTL_MS);
  // Decode without wall-clock verification: injectable now() may be far from Date.now().
  const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
  assert.equal(claims.exp, Math.floor(reservation.pendingUntil / 1000));
  assert.ok(claims.exp * 1000 <= reservation.pendingUntil);
});

function decodeJwtClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// Regression: abandoned pending seats must free capacity at pendingUntil (<= now()),
// and the issued LiveKit token must not remain usable past that same absolute time.
test('expired pending reservation releases capacity at the pendingUntil boundary', async t => {
  let clock = 7_000_000;
  const { createAdmissionStore } = await import('../server/admissions.js');
  const admissions = createAdmissionStore();
  const revoked = [];
  const { join } = await fixture(t, {
    removeParticipant: async (_room, identity) => { revoked.push(identity); },
  }, config, { now: () => clock, admissions });

  assert.equal(admissions.entries.size, 0);
  const seats = [];
  for (let i = 0; i < MAX_PARTICIPANTS; i++) {
    seats.push(await (await join({ name: `Guest ${i}`, accessCode: config.ROOM_ACCESS_CODE })).json());
  }
  const a = seats[0];
  const aReservation = admissions.entries.get(a.identity);
  assert.ok(aReservation);
  const aPendingUntil = aReservation.pendingUntil;

  // One millisecond before expiry the seat still blocks admission.
  clock = aPendingUntil - 1;
  assert.equal((await join()).status, 409);
  assert.equal(admissions.entries.has(a.identity), true);

  // Exact boundary: pendingUntil <= now() treats the reservation as expired.
  clock = aPendingUntil;
  const b = await join({ name: 'Replacement', accessCode: config.ROOM_ACCESS_CODE });
  assert.equal(b.status, 200);
  assert.equal(admissions.entries.has(a.identity), false);
  assert.ok(revoked.includes(a.identity));
  assert.notEqual((await b.json()).identity, a.identity);
});

test('old token expiration matches the reservation pendingUntil', async t => {
  let clock = 8_000_000;
  const { createAdmissionStore } = await import('../server/admissions.js');
  const admissions = createAdmissionStore();
  const { join } = await fixture(t, {}, config, { now: () => clock, admissions });
  const body = await (await join()).json();
  const reservation = admissions.entries.get(body.identity);
  assert.ok(reservation);
  // Decode claims only — do not wall-clock-verify against Date.now() while now() is mocked.
  const claims = decodeJwtClaims(body.token);
  assert.equal(Math.floor(reservation.pendingUntil / 1000), claims.exp);
  assert.ok(claims.exp * 1000 <= reservation.pendingUntil);
});

test('token exp cannot remain valid after the reservation expiration point', async t => {
  let clock = 9_000_000;
  const { createAdmissionStore } = await import('../server/admissions.js');
  const admissions = createAdmissionStore();
  const { join } = await fixture(t, {}, config, { now: () => clock, admissions });

  assert.equal(admissions.entries.size, 0);
  const seats = [];
  for (let i = 0; i < MAX_PARTICIPANTS; i++) {
    seats.push(await (await join({ name: `Seat ${i}`, accessCode: config.ROOM_ACCESS_CODE })).json());
  }
  const a = seats[0];
  const aReservation = admissions.entries.get(a.identity);
  assert.ok(aReservation);
  const aPendingUntil = aReservation.pendingUntil;
  const aClaims = decodeJwtClaims(a.token);

  // Authoritative binding: token.exp is derived from reservation.pendingUntil.
  // Would fail if token TTL were restored to pendingUntil+1s or pendingUntil+10m.
  const expectedExp = Math.floor(aPendingUntil / 1000);
  assert.equal(aClaims.exp, expectedExp);
  assert.ok(aClaims.exp * 1000 <= aPendingUntil);
  assert.notEqual(aClaims.exp, Math.floor((aPendingUntil + 1000) / 1000));
  assert.notEqual(aClaims.exp, Math.floor((aPendingUntil + 10 * 60 * 1000) / 1000));

  clock = aPendingUntil;
  assert.equal((await join({ name: 'After expiry', accessCode: config.ROOM_ACCESS_CODE })).status, 200);
  assert.equal(admissions.entries.has(a.identity), false);

  // After the application releases A's seat, the abandoned token's exp is still
  // no later than the reservation expiration that freed that seat.
  assert.ok(aClaims.exp * 1000 <= aPendingUntil);
  assert.ok(aClaims.exp * 1000 <= clock);
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

test('normalizeIp maps IPv4-mapped IPv6 addresses', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIp('127.0.0.1'), '127.0.0.1');
});

test('failed access-code attempts are limited per IP with Retry-After', async t => {
  let clock = 10_000_000;
  let ip = '203.0.113.10';
  const joinRateLimiter = createJoinRateLimiter({ now: () => clock });
  const { join } = await fixture(t, {}, config, {
    now: () => clock,
    joinRateLimiter,
    getClientIp: () => ip,
  });
  for (let i = 0; i < JOIN_RATE_LIMIT_MAX_FAILURES; i++) {
    const response = await join({ name: 'Guest', accessCode: 'wrong' });
    assert.equal(response.status, 403);
  }
  const limited = await join({ name: 'Guest', accessCode: 'wrong' });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'Too many attempts. Please try again later.');
  const retryAfter = Number(limited.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);
  assert.ok(retryAfter <= Math.ceil(JOIN_RATE_LIMIT_WINDOW_MS / 1000));
  // Rate-limited responses must not reveal whether a guess was correct.
  const limitedCorrect = await join({ name: 'Guest', accessCode: config.ROOM_ACCESS_CODE });
  assert.equal(limitedCorrect.status, 429);
});

test('successful joins and LiveKit errors do not consume the failure budget', async t => {
  let clock = 20_000_000;
  const joinRateLimiter = createJoinRateLimiter({ now: () => clock });
  const { join } = await fixture(t, {}, config, {
    now: () => clock,
    joinRateLimiter,
    getClientIp: () => '203.0.113.20',
  });
  for (let i = 0; i < JOIN_RATE_LIMIT_MAX_FAILURES - 1; i++) {
    assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  }
  assert.equal((await join()).status, 200);
  const failing = await fixture(t, { listParticipants: async () => { throw new Error('Unavailable'); } }, config, {
    now: () => clock,
    joinRateLimiter,
    getClientIp: () => '203.0.113.20',
  });
  assert.equal((await failing.join()).status, 502);
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 429);
});

test('join rate limits are independent per IP and reset after the window', async t => {
  let clock = 30_000_000;
  let ip = '203.0.113.30';
  const joinRateLimiter = createJoinRateLimiter({ now: () => clock });
  const { join } = await fixture(t, {}, config, {
    now: () => clock,
    joinRateLimiter,
    getClientIp: () => ip,
  });
  for (let i = 0; i < JOIN_RATE_LIMIT_MAX_FAILURES; i++) {
    assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  }
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 429);
  ip = '203.0.113.31';
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  ip = '203.0.113.30';
  clock += JOIN_RATE_LIMIT_WINDOW_MS;
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  assert.equal((await join()).status, 200);
});

test('expired join rate-limit entries are removed from memory', async t => {
  let clock = 40_000_000;
  const joinRateLimiter = createJoinRateLimiter({ now: () => clock });
  joinRateLimiter.recordFailure('198.51.100.1');
  joinRateLimiter.recordFailure('198.51.100.2');
  assert.equal(joinRateLimiter.size(), 2);
  clock += JOIN_RATE_LIMIT_WINDOW_MS;
  joinRateLimiter.cleanup();
  assert.equal(joinRateLimiter.size(), 0);
});

function fakeReq({ remoteAddress = '127.0.0.1', forwardedFor } = {}) {
  const headers = {};
  if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor;
  return { socket: { remoteAddress }, headers };
}

test('without trusted proxies, forged X-Forwarded-For is ignored', () => {
  const getClientIp = createClientIpResolver();
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '198.51.100.10', forwardedFor: '203.0.113.1' })),
    '198.51.100.10',
  );
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '::ffff:198.51.100.10', forwardedFor: '203.0.113.1' })),
    '198.51.100.10',
  );
});

test('trusted proxy uses forwarded client IP and normalizes IPv4-mapped IPv6', () => {
  const getClientIp = createClientIpResolver({ trustedProxyIps: ['127.0.0.1'] });
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '127.0.0.1', forwardedFor: '::ffff:203.0.113.9' })),
    '203.0.113.9',
  );
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '::ffff:127.0.0.1', forwardedFor: '203.0.113.9' })),
    '203.0.113.9',
  );
});

test('trusted proxy walks X-Forwarded-For from the right past trusted hops', () => {
  const getClientIp = createClientIpResolver({ trustedProxyIps: ['127.0.0.1', '10.0.0.2'] });
  assert.equal(
    getClientIp(fakeReq({
      remoteAddress: '127.0.0.1',
      forwardedFor: '203.0.113.50, 10.0.0.2',
    })),
    '203.0.113.50',
  );
  assert.equal(
    getClientIp(fakeReq({
      remoteAddress: '127.0.0.1',
      forwardedFor: '198.51.100.7, 203.0.113.50, 10.0.0.2',
    })),
    '203.0.113.50',
  );
});

test('untrusted peers cannot set the client IP via X-Forwarded-For', () => {
  const getClientIp = createClientIpResolver({ trustedProxyIps: ['127.0.0.1'] });
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '203.0.113.99', forwardedFor: '198.51.100.1' })),
    '203.0.113.99',
  );
});

test('malformed forwarded addresses do not crash and fall back safely', () => {
  const getClientIp = createClientIpResolver({ trustedProxyIps: ['127.0.0.1'] });
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '127.0.0.1', forwardedFor: 'not-an-ip' })),
    '127.0.0.1',
  );
  assert.equal(
    getClientIp(fakeReq({ remoteAddress: '127.0.0.1', forwardedFor: '!!!, 203.0.113.8' })),
    '203.0.113.8',
  );
  assert.equal(parseTrustedProxyIps('127.0.0.1, not-an-ip, ::1').includes('not-an-ip'), false);
});

test('distinct clients behind a trusted proxy have independent join rate limits', async t => {
  let clock = 50_000_000;
  let forwarded = '203.0.113.60';
  const resolve = createClientIpResolver({ trustedProxyIps: ['127.0.0.1'] });
  const joinRateLimiter = createJoinRateLimiter({ now: () => clock });
  const { join } = await fixture(t, {}, config, {
    now: () => clock,
    joinRateLimiter,
    getClientIp: () => resolve(fakeReq({ remoteAddress: '127.0.0.1', forwardedFor: forwarded })),
  });
  for (let i = 0; i < JOIN_RATE_LIMIT_MAX_FAILURES; i++) {
    assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  }
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 429);
  forwarded = '203.0.113.61';
  assert.equal((await join({ name: 'Guest', accessCode: 'wrong' })).status, 403);
  assert.equal((await join()).status, 200);
});

test('new room prompt starts empty and GET returns current state', async t => {
  const { join, getPrompt } = await fixture(t);
  const seat = await (await join()).json();
  const response = await getPrompt(seat);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    draft: '',
    version: 0,
    status: 'draft',
    versions: [],
  });
});

test('PUT updates the shared draft and GET returns it', async t => {
  const { join, getPrompt, putPrompt } = await fixture(t);
  const seat = await (await join()).json();
  const updated = await putPrompt(seat, 'Build a login form');
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), {
    draft: 'Build a login form',
    version: 0,
    status: 'draft',
    versions: [],
  });
  assert.equal((await (await getPrompt(seat)).json()).draft, 'Build a login form');
});

test('finalizing a non-empty draft creates immutable versions in order', async t => {
  let clock = 60_000_000;
  const { join, putPrompt, finalizePrompt, getPrompt } = await fixture(t, {}, config, {
    now: () => clock,
    prompts: createPromptStore({ now: () => clock }),
  });
  const seat = await (await join({ name: 'Alice', accessCode: config.ROOM_ACCESS_CODE })).json();
  await putPrompt(seat, 'First prompt');
  const first = await finalizePrompt(seat);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), {
    version: 1,
    prompt: 'First prompt',
    status: 'finalized',
    createdAt: new Date(60_000_000).toISOString(),
    finalizedBy: 'Alice',
  });

  clock = 60_000_500;
  await putPrompt(seat, 'Second prompt');
  const second = await finalizePrompt(seat);
  assert.equal(second.status, 201);
  assert.equal((await second.json()).version, 2);

  const state = await (await getPrompt(seat)).json();
  assert.equal(state.version, 2);
  assert.equal(state.status, 'draft');
  assert.equal(state.draft, 'Second prompt');
  assert.equal(state.versions[0].prompt, 'First prompt');
  assert.equal(state.versions[1].prompt, 'Second prompt');

  // Finalized contents stay immutable even if the draft changes later.
  await putPrompt(seat, 'Edited after finalize');
  const afterEdit = await (await getPrompt(seat)).json();
  assert.equal(afterEdit.draft, 'Edited after finalize');
  assert.equal(afterEdit.versions[0].prompt, 'First prompt');
  assert.equal(afterEdit.versions[1].prompt, 'Second prompt');
});

test('finalizing an empty draft is rejected', async t => {
  const { join, putPrompt, finalizePrompt } = await fixture(t);
  const seat = await (await join()).json();
  assert.equal((await finalizePrompt(seat)).status, 400);
  await putPrompt(seat, '   ');
  const blank = await finalizePrompt(seat);
  assert.equal(blank.status, 400);
  assert.match((await blank.json()).error, /empty/i);
});

test('concurrent finalize requests cannot produce duplicate version numbers', async t => {
  const { join, putPrompt, finalizePrompt, getPrompt } = await fixture(t);
  const a = await (await join({ name: 'A', accessCode: config.ROOM_ACCESS_CODE })).json();
  const b = await (await join({ name: 'B', accessCode: config.ROOM_ACCESS_CODE })).json();
  await putPrompt(a, 'Shared concurrent draft');
  const results = await Promise.all([finalizePrompt(a), finalizePrompt(b)]);
  assert.deepEqual(results.map(response => response.status).sort(), [201, 201]);
  const bodies = await Promise.all(results.map(response => response.json()));
  const versions = bodies.map(body => body.version).sort((left, right) => left - right);
  assert.deepEqual(versions, [1, 2]);
  assert.equal(bodies[0].prompt, 'Shared concurrent draft');
  assert.equal(bodies[1].prompt, 'Shared concurrent draft');
  const state = await (await getPrompt(a)).json();
  assert.deepEqual(state.versions.map(entry => entry.version), [1, 2]);
});

test('room prompt state is isolated between different rooms', async t => {
  const sharedPrompts = createPromptStore();
  const roomA = await fixture(t, {}, config, { roomName: 'room-a', prompts: sharedPrompts });
  const roomB = await fixture(t, {}, config, { roomName: 'room-b', prompts: sharedPrompts });
  const seatA = await (await roomA.join({ name: 'A', accessCode: config.ROOM_ACCESS_CODE })).json();
  const seatB = await (await roomB.join({ name: 'B', accessCode: config.ROOM_ACCESS_CODE })).json();
  assert.equal(seatA.roomName, 'room-a');
  assert.equal(seatB.roomName, 'room-b');

  await roomA.putPrompt(seatA, 'Prompt for A');
  await roomB.putPrompt(seatB, 'Prompt for B');
  assert.equal((await (await roomA.getPrompt(seatA)).json()).draft, 'Prompt for A');
  assert.equal((await (await roomB.getPrompt(seatB)).json()).draft, 'Prompt for B');

  // Cross-room reads/writes are rejected for the wrong room identity.
  assert.equal((await roomA.getPrompt(seatA, 'room-b')).status, 404);
  assert.equal((await roomA.putPrompt(seatA, 'tamper', 'room-b')).status, 404);
  assert.equal((await roomB.getPrompt(seatB, 'room-a')).status, 404);

  await roomA.finalizePrompt(seatA);
  await roomB.putPrompt(seatB, 'Room B iteration two');
  await roomB.finalizePrompt(seatB);
  await roomB.finalizePrompt(seatB);
  assert.equal((await (await roomA.getPrompt(seatA)).json()).version, 1);
  assert.equal((await (await roomB.getPrompt(seatB)).json()).version, 2);
});

test('prompt API rejects invalid drafts, oversized payloads, and non-joined access', async t => {
  const { join, putPrompt, getPrompt, finalizePrompt, base } = await fixture(t);
  const seat = await (await join()).json();

  const missingAuth = await fetch(base + '/api/rooms/' + encodeURIComponent(ROOM_NAME) + '/prompt');
  assert.equal(missingAuth.status, 403);

  const wrongKey = await getPrompt({ ...seat, leaveKey: 'not-the-key' });
  assert.equal(wrongKey.status, 403);

  const afterLeave = await (await join({ name: 'Leaver', accessCode: config.ROOM_ACCESS_CODE })).json();
  const leaveResponse = await fetch(base + '/api/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: afterLeave.identity, leaveKey: afterLeave.leaveKey }),
  });
  assert.equal(leaveResponse.status, 204);
  assert.equal((await getPrompt(afterLeave)).status, 403);
  assert.equal((await putPrompt(afterLeave, 'nope')).status, 403);
  assert.equal((await finalizePrompt(afterLeave)).status, 403);

  const invalidType = await fetch(base + '/api/rooms/' + encodeURIComponent(ROOM_NAME) + '/prompt', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-participant-identity': seat.identity,
      'x-leave-key': seat.leaveKey,
    },
    body: JSON.stringify({ draft: 42 }),
  });
  assert.equal(invalidType.status, 400);

  const oversized = await putPrompt(seat, 'x'.repeat(MAX_PROMPT_LENGTH + 1));
  assert.equal(oversized.status, 413);
});

test('admitted participant can record a manual run for a finalized prompt', async t => {
  let clock = 70_000_000;
  let ids = 0;
  const { join, putPrompt, finalizePrompt, createRun, getRun, getRunImage, listRuns } = await fixture(t, {}, config, {
    now: () => clock,
    prompts: createPromptStore({ now: () => clock }),
    runs: createRunStore({ now: () => clock, createId: () => 'run_test_' + (++ids) }),
  });
  const seat = await (await join({ name: 'Arjun', accessCode: config.ROOM_ACCESS_CODE })).json();
  await putPrompt(seat, 'Exact finalized prompt text');
  await finalizePrompt(seat);
  await putPrompt(seat, 'Draft changed after finalize');

  const created = await createRun(seat, {
    promptVersion: 1,
    status: 'success',
    notes: 'Build completed successfully.',
    ...jpegPayload(),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.id, 'run_test_1');
  assert.equal(body.roomName, ROOM_NAME);
  assert.equal(body.promptVersion, 1);
  assert.equal(body.promptSnapshot, 'Exact finalized prompt text');
  assert.equal(body.executedBy, 'Arjun');
  assert.equal(body.executedAt, new Date(70_000_000).toISOString());
  assert.equal(body.status, 'success');
  assert.equal(body.notes, 'Build completed successfully.');
  assert.equal(body.imageUrl, `/api/rooms/${encodeURIComponent(ROOM_NAME)}/runs/run_test_1/image`);
  assert.equal('jpeg' in body, false);

  const fetched = await (await getRun(seat, body.id)).json();
  assert.equal(fetched.promptSnapshot, 'Exact finalized prompt text');
  assert.equal(fetched.executedBy, 'Arjun');

  const image = await getRunImage(seat, body.id);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xFF, 0xD8, 0xFF]));

  clock = 70_001_000;
  const second = await createRun(seat, {
    promptVersion: 1,
    status: 'failure',
    notes: 'Retry failed',
    ...jpegPayload(sampleJpeg(8)),
  });
  assert.equal(second.status, 201);
  assert.equal((await second.json()).id, 'run_test_2');

  const listed = await (await listRuns(seat)).json();
  assert.deepEqual(listed.runs.map(run => run.id), ['run_test_2', 'run_test_1']);
});

test('run creation validates prompt version, status, and JPEG input', async t => {
  const { join, putPrompt, finalizePrompt, createRun, getRun, base } = await fixture(t);
  const seat = await (await join({ name: 'Akshay', accessCode: config.ROOM_ACCESS_CODE })).json();

  assert.equal((await createRun(seat, { promptVersion: 1, status: 'success', ...jpegPayload() })).status, 404);
  assert.equal((await createRun(seat, { promptVersion: 0, status: 'success', ...jpegPayload() })).status, 400);
  assert.equal((await createRun(seat, { promptVersion: -1, status: 'success', ...jpegPayload() })).status, 400);

  await putPrompt(seat, 'Ready to finalize');
  // Draft alone cannot be used until finalized.
  assert.equal((await createRun(seat, { promptVersion: 1, status: 'success', ...jpegPayload() })).status, 404);
  await finalizePrompt(seat);

  assert.equal((await createRun(seat, { promptVersion: 1, status: 'maybe', ...jpegPayload() })).status, 400);
  assert.equal((await createRun(seat, { promptVersion: 1, status: 'success' })).status, 400);
  assert.equal((await createRun(seat, {
    promptVersion: 1, status: 'success', contentType: 'image/png', jpegBase64: sampleJpeg().toString('base64'),
  })).status, 415);
  assert.equal((await createRun(seat, {
    promptVersion: 1, status: 'success', contentType: 'image/jpeg', jpegBase64: Buffer.from('not-a-jpeg').toString('base64'),
  })).status, 400);
  assert.equal((await createRun(seat, {
    promptVersion: 1, status: 'success', contentType: 'image/jpeg',
    // 4-byte SOI prefix + padding => exactly one byte over MAX_JPEG_BYTES.
    jpegBase64: sampleJpeg(MAX_JPEG_BYTES - 3).toString('base64'),
  })).status, 413);

  const ok = await createRun(seat, { promptVersion: 1, status: 'failure', ...jpegPayload() });
  assert.equal(ok.status, 201);
  assert.equal((await getRun(seat, 'missing-run')).status, 404);
  assert.equal((await fetch(base + '/api/rooms/' + encodeURIComponent(ROOM_NAME) + '/runs')).status, 403);
});

test('run history is isolated between rooms', async t => {
  const sharedPrompts = createPromptStore();
  const sharedRuns = createRunStore();
  const roomA = await fixture(t, {}, config, { roomName: 'room-a', prompts: sharedPrompts, runs: sharedRuns });
  const roomB = await fixture(t, {}, config, { roomName: 'room-b', prompts: sharedPrompts, runs: sharedRuns });
  const seatA = await (await roomA.join({ name: 'A', accessCode: config.ROOM_ACCESS_CODE })).json();
  const seatB = await (await roomB.join({ name: 'B', accessCode: config.ROOM_ACCESS_CODE })).json();

  await roomA.putPrompt(seatA, 'Room A prompt');
  await roomA.finalizePrompt(seatA);
  await roomB.putPrompt(seatB, 'Room B prompt');
  await roomB.finalizePrompt(seatB);

  const createdA = await (await roomA.createRun(seatA, {
    promptVersion: 1, status: 'success', ...jpegPayload(),
  })).json();
  const createdB = await (await roomB.createRun(seatB, {
    promptVersion: 1, status: 'failure', ...jpegPayload(sampleJpeg(4)),
  })).json();

  assert.equal((await (await roomA.listRuns(seatA)).json()).runs.length, 1);
  assert.equal((await (await roomB.listRuns(seatB)).json()).runs.length, 1);
  assert.equal((await roomA.listRuns(seatA, 'room-b')).status, 404);
  assert.equal((await roomA.getRun(seatA, createdB.id)).status, 404);
  assert.equal((await roomA.getRun(seatA, createdB.id, 'room-b')).status, 404);
  assert.equal((await roomA.getRunImage(seatA, createdB.id, 'room-b')).status, 404);
  assert.equal((await roomA.getRunImage(seatA, createdA.id)).status, 200);
  assert.equal((await roomB.getRunImage(seatB, createdB.id)).status, 200);
  assert.notEqual(createdA.promptSnapshot, createdB.promptSnapshot);
});
