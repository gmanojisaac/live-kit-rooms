import 'dotenv/config';
import express from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json({ limit: '10kb' }));
const roomName = 'collaborative-development-room';
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE } = process.env;
const port = Number(process.env.PORT || 3001);
const configured = [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ROOM_ACCESS_CODE]
  .every((value) => typeof value === 'string' && value.trim().length > 0);
const client = configured
  ? new RoomServiceClient(LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

function matchesCode(provided) {
  if (typeof provided !== 'string' || !ROOM_ACCESS_CODE) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(ROOM_ACCESS_CODE);
  return left.length === right.length && timingSafeEqual(left, right);
}

app.post('/api/join', async (req, res) => {
  if (!configured) return res.status(503).json({ error: 'Server is not configured. Set the environment variables.' });
  const { name, accessCode } = req.body || {};
  if (!matchesCode(accessCode)) return res.status(403).json({ error: 'Incorrect access code.' });
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
    return res.status(400).json({ error: 'Enter a name (1–40 characters).' });
  }
  try {
    const participants = await client.listParticipants(roomName).catch((error) => {
      // A room may not exist yet. Do not mistake all service errors for an empty room.
      if (error?.code === 404 || error?.status === 404) return [];
      throw error;
    });
    if (participants.length >= 6) return res.status(409).json({ error: 'This trial room already has six participants.' });
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: randomUUID(), name: name.trim(), ttl: '2h'
    });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    return res.json({ token: await token.toJwt(), serverUrl: LIVEKIT_URL, roomName });
  } catch (error) {
    console.error('Room join failed:', error);
    return res.status(502).json({ error: 'Could not connect to LiveKit. Check the project URL and credentials.' });
  }
});

const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(here, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(here, 'dist', 'index.html')));
app.listen(port, () => console.log(`App server running on http://localhost:${port}`));
