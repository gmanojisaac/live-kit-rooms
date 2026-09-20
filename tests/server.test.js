import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  createApp, MAX_PARTICIPANTS, RESERVATION_TTL_MS, ROOM_NAME,
  JOIN_RATE_LIMIT_MAX_FAILURES, JOIN_RATE_LIMIT_WINDOW_MS, createJoinRateLimiter, normalizeIp,
  createClientIpResolver, parseTrustedProxyIps,
} from '../server/app.js';

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
