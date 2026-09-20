import express from 'express';
import { AccessToken, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdmissionStore } from './admissions.js';

export const ROOM_NAME = 'collaborative-development-room';
export const MAX_PARTICIPANTS = 6;
const here = path.dirname(fileURLToPath(import.meta.url));

function constantTimeMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({
  config = process.env, roomService, roomName = ROOM_NAME, logger = console,
  admissions = createAdmissionStore(), now = Date.now,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE } = config;
  const configured = [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE]
    .every(value => typeof value === 'string' && value.trim().length > 0);
  const client = roomService || (configured
    ? new RoomServiceClient(LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    : null);

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
    const { name, accessCode } = req.body || {};
    if (!constantTimeMatch(accessCode, ROOM_ACCESS_CODE)) return res.status(403).json({ error: 'Incorrect access code.' });
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
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
        const leaveKey = randomUUID();
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity, name: name.trim(), ttl: '10m',
        });
        token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
        token.roomConfig = new RoomConfiguration({ name: roomName, maxParticipants: MAX_PARTICIPANTS, departureTimeout: 20 });
        const jwt = await token.toJwt();
        admissions.entries.set(identity, { leaveKey, pendingUntil: now() + 120_000 });
        admissions.save();
        return res.json({ token: jwt, serverUrl: LIVEKIT_URL, roomName, identity, leaveKey });
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

  app.use(express.static(path.join(here, '..', 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(here, '..', 'dist', 'index.html')));
  return app;
}