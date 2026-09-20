import express from 'express';
import { AccessToken, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdmissionStore, createReservation, RESERVATION_TTL_MS } from './admissions.js';
import { decodeJpegBase64, MAX_JPEG_BYTES } from './jpeg.js';
import { createPromptStore, MAX_PROMPT_LENGTH } from './prompts.js';
import { createClientIpResolver, createJoinRateLimiter, parseTrustedProxyIps } from './rate-limit.js';
import { createRunStore, MAX_RUN_NOTES_LENGTH, RUN_STATUSES } from './runs.js';

export { RESERVATION_TTL_MS, MAX_PROMPT_LENGTH, MAX_JPEG_BYTES, MAX_RUN_NOTES_LENGTH, RUN_STATUSES };
export {
  JOIN_RATE_LIMIT_MAX_FAILURES, JOIN_RATE_LIMIT_WINDOW_MS, createJoinRateLimiter, clientIp, normalizeIp,
  createClientIpResolver, parseTrustedProxyIps, isValidIp,
} from './rate-limit.js';
export const ROOM_NAME = 'collaborative-development-room';
export const MAX_PARTICIPANTS = 6;
const here = path.dirname(fileURLToPath(import.meta.url));

function constantTimeMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readParticipantCredentials(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return {
    identity: req.get('x-participant-identity') || body.identity,
    leaveKey: req.get('x-leave-key') || body.leaveKey,
  };
}

export function createApp({
  config = process.env, roomService, roomName = ROOM_NAME, logger = console,
  admissions = createAdmissionStore(), prompts, runs, now = Date.now,
  joinRateLimiter = createJoinRateLimiter({ now }),
  getClientIp = createClientIpResolver({
    trustedProxyIps: parseTrustedProxyIps(config.TRUSTED_PROXY_IPS),
  }),
} = {}) {
  const app = express();
  // Base64 JPEG payloads need headroom above MAX_JPEG_BYTES (~5 MiB raw ≈ ~6.7 MiB encoded).
  app.use(express.json({ limit: '7mb' }));
  const promptStore = prompts || createPromptStore({ now });
  const runStore = runs || createRunStore({ now });
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE } = config;
  const configured = [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE]
    .every(value => typeof value === 'string' && value.trim().length > 0);
  const client = roomService || (configured
    ? new RoomServiceClient(LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    : null);

  function requireAdmittedParticipant(req, res) {
    const { identity, leaveKey } = readParticipantCredentials(req);
    const reservation = typeof identity === 'string' ? admissions.entries.get(identity) : undefined;
    if (!reservation || !constantTimeMatch(leaveKey, reservation.leaveKey)) {
      res.status(403).json({ error: 'Join the room before using the prompt workspace.' });
      return null;
    }
    return { identity, name: reservation.name };
  }

  function assertKnownRoom(requestedRoom, res) {
    if (requestedRoom !== roomName) {
      res.status(404).json({ error: 'Room not found.' });
      return false;
    }
    return true;
  }

  async function revoke(identity) {
    try {
      // Cloud revokes even when the participant has already left. The explicit
      // timestamp also covers a token issued in the same second as this request.
      await client.removeParticipant(roomName, identity, { revokeTokenTs: BigInt(Math.floor(now() / 1000) + 1) });
    } catch (error) {
      if (error.code !== 'not_found' && error.status !== 404) throw error;
    }
  }

  app.post('/api/join', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured) return res.status(503).json({ error: 'Server is not configured. Set the environment variables.' });
    const ip = getClientIp(req);
    const limit = joinRateLimiter.check(ip);
    if (limit.limited) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    const { name, accessCode } = req.body || {};
    if (!constantTimeMatch(accessCode, ROOM_ACCESS_CODE)) {
      joinRateLimiter.recordFailure(ip);
      return res.status(403).json({ error: 'Incorrect access code.' });
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
      joinRateLimiter.recordFailure(ip);
      return res.status(400).json({ error: 'Enter a name (1–40 characters).' });
    }
    try {
      await admissions.exclusive(async () => {
        const existing = (await client.listRooms([roomName]))[0];
        // Do not migrate a running unlimited room or disconnect its participants.
        if (existing && existing.maxParticipants !== MAX_PARTICIPANTS) {
          return res.status(409).json({
            error: `The previous trial room is still open. Everyone must leave it, then wait for it to close (usually about one minute) and try again to enable the ${MAX_PARTICIPANTS}-person limit.`,
          });
        }
        const room = await client.createRoom({
          name: roomName, maxParticipants: MAX_PARTICIPANTS, emptyTimeout: 300, departureTimeout: 20,
        });
        if (room.maxParticipants !== MAX_PARTICIPANTS) throw new Error('Room limit was not applied');
        const participants = await client.listParticipants(roomName);
        const active = new Set(participants.map(participant => participant.identity));
        for (const [identity, reservation] of admissions.entries) {
          if (!active.has(identity) && reservation.pendingUntil <= now()) {
            await revoke(identity);
            admissions.entries.delete(identity);
          }
        }
        admissions.save();
        // Count active participants PLUS issued-but-not-yet-connected identities.
        const occupied = new Set([...active, ...admissions.entries.keys()]);
        if (occupied.size >= MAX_PARTICIPANTS) {
          return res.status(409).json({
            error: `This trial room already has ${MAX_PARTICIPANTS} participants or pending joins. Try again after someone leaves; an abandoned join clears after two minutes.`,
          });
        }
        const identity = randomUUID();
        const reservation = { ...createReservation(randomUUID(), now), name: name.trim() };
        // Absolute token expiry is the reservation's pendingUntil, so the JWT cannot outlive the seat hold.
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity, name: reservation.name, ttl: new Date(reservation.pendingUntil),
        });
        token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
        token.roomConfig = new RoomConfiguration({ name: roomName, maxParticipants: MAX_PARTICIPANTS, departureTimeout: 20 });
        const jwt = await token.toJwt();
        admissions.entries.set(identity, reservation);
        admissions.save();
        return res.json({ token: jwt, serverUrl: LIVEKIT_URL, roomName, identity, leaveKey: reservation.leaveKey });
      });
    } catch (error) {
      logger.error('Room join failed:', error.name || 'Error');
      return res.status(502).json({ error: 'Could not prepare the LiveKit room. Check the server credentials and connection, then try again.' });
    }
  });

  app.post('/api/leave', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured) return res.sendStatus(503);
    const { identity, leaveKey } = req.body || {};
    try {
      await admissions.exclusive(async () => {
        const reservation = admissions.entries.get(identity);
        if (!reservation || !constantTimeMatch(leaveKey, reservation.leaveKey)) return res.sendStatus(403);
        await revoke(identity);
        admissions.entries.delete(identity);
        admissions.save();
        return res.sendStatus(204);
      });
    } catch (error) {
      logger.error('Room leave failed:', error.name || 'Error');
      res.sendStatus(502);
    }
  });

  app.get('/api/rooms/:roomName/prompt', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    if (!requireAdmittedParticipant(req, res)) return;
    try {
      const state = await promptStore.exclusive(() => promptStore.get(req.params.roomName));
      return res.json(state);
    } catch (error) {
      logger.error('Prompt read failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not load the prompt workspace.' });
    }
  });

  app.put('/api/rooms/:roomName/prompt', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    if (!requireAdmittedParticipant(req, res)) return;
    const { draft } = req.body || {};
    if (typeof draft !== 'string') {
      return res.status(400).json({ error: 'Draft must be a string.' });
    }
    if (draft.length > MAX_PROMPT_LENGTH) {
      return res.status(413).json({
        error: `Draft exceeds the maximum length of ${MAX_PROMPT_LENGTH} characters.`,
      });
    }
    try {
      const state = await promptStore.exclusive(() => promptStore.putDraft(req.params.roomName, draft));
      return res.json(state);
    } catch (error) {
      logger.error('Prompt update failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not update the prompt draft.' });
    }
  });

  app.post('/api/rooms/:roomName/prompt/finalize', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    const participant = requireAdmittedParticipant(req, res);
    if (!participant) return;
    try {
      // Serialize through the prompt store so concurrent finalize calls never share a version number.
      const finalized = await promptStore.exclusive(() => promptStore.finalize(
        req.params.roomName,
        participant.name || participant.identity,
      ));
      return res.status(201).json(finalized);
    } catch (error) {
      if (error.code === 'EMPTY_DRAFT') {
        return res.status(400).json({ error: 'Cannot finalize an empty prompt. Add content to the draft first.' });
      }
      logger.error('Prompt finalize failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not finalize the prompt.' });
    }
  });

  app.get('/api/rooms/:roomName/runs', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    if (!requireAdmittedParticipant(req, res)) return;
    try {
      const runs = await runStore.exclusive(() => runStore.list(req.params.roomName));
      return res.json({ runs });
    } catch (error) {
      logger.error('Run list failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not load run history.' });
    }
  });

  app.post('/api/rooms/:roomName/runs', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    const participant = requireAdmittedParticipant(req, res);
    if (!participant) return;

    const body = req.body || {};
    const promptVersion = body.promptVersion;
    if (!Number.isInteger(promptVersion) || promptVersion < 1) {
      return res.status(400).json({ error: 'Select a finalized prompt version.' });
    }
    if (!RUN_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: 'Select a status of success or failure.' });
    }
    if (body.notes != null && typeof body.notes !== 'string') {
      return res.status(400).json({ error: 'Notes must be a string.' });
    }
    if (typeof body.notes === 'string' && body.notes.length > MAX_RUN_NOTES_LENGTH) {
      return res.status(400).json({
        error: `Notes exceed the maximum length of ${MAX_RUN_NOTES_LENGTH} characters.`,
      });
    }

    let jpeg;
    try {
      jpeg = decodeJpegBase64(body.jpegBase64 ?? body.jpeg, { contentType: body.contentType });
    } catch (error) {
      if (error.code === 'MISSING_JPEG') return res.status(400).json({ error: error.message });
      if (error.code === 'INVALID_IMAGE_TYPE') return res.status(415).json({ error: error.message });
      if (error.code === 'JPEG_TOO_LARGE') return res.status(413).json({ error: error.message });
      if (error.code === 'MALFORMED_JPEG') return res.status(400).json({ error: error.message });
      throw error;
    }

    try {
      const finalized = await promptStore.exclusive(() => promptStore.getVersion(req.params.roomName, promptVersion));
      if (!finalized) {
        return res.status(404).json({ error: 'That finalized prompt version was not found.' });
      }
      // Metadata and JPEG are written together inside one run-store mutation.
      const created = await runStore.exclusive(() => runStore.create(req.params.roomName, {
        promptVersion: finalized.version,
        promptSnapshot: finalized.prompt,
        executedBy: participant.name || participant.identity,
        status: body.status,
        notes: body.notes || '',
        jpeg,
      }));
      return res.status(201).json(created);
    } catch (error) {
      if (error.code === 'INVALID_STATUS' || error.code === 'INVALID_NOTES' || error.code === 'NOTES_TOO_LONG'
        || error.code === 'MISSING_JPEG') {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Run create failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not record the manual run.' });
    }
  });

  app.get('/api/rooms/:roomName/runs/:runId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    if (!requireAdmittedParticipant(req, res)) return;
    try {
      const run = await runStore.exclusive(() => runStore.get(req.params.roomName, req.params.runId));
      if (!run) return res.status(404).json({ error: 'Run not found.' });
      return res.json(run);
    } catch (error) {
      logger.error('Run read failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not load the run.' });
    }
  });

  app.get('/api/rooms/:roomName/runs/:runId/image', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!assertKnownRoom(req.params.roomName, res)) return;
    if (!requireAdmittedParticipant(req, res)) return;
    try {
      const jpeg = await runStore.exclusive(() => runStore.getJpeg(req.params.roomName, req.params.runId));
      if (!jpeg) return res.status(404).json({ error: 'Run not found.' });
      res.set({
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      });
      return res.send(jpeg);
    } catch (error) {
      logger.error('Run image read failed:', error.name || 'Error');
      return res.status(500).json({ error: 'Could not load the run image.' });
    }
  });

  app.use(express.static(path.join(here, '..', 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(here, '..', 'dist', 'index.html')));
  return app;
}