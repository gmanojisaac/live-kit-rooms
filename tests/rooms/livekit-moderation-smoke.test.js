/**

 * Narrow LiveKit Cloud smoke for AUTH-05 room admin APIs.

 * Creates and deletes an empty room only — does not join participants.

 * Skips when LiveKit credentials are missing.

 */



import test from 'node:test';

import assert from 'node:assert/strict';

import { config as loadEnv } from 'dotenv';

import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { createLiveKitRoomService } from '../../lib/livekit/rooms.js';



const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

loadEnv({ path: path.join(root, '.env') });

loadEnv({ path: path.join(root, '.env.local'), override: true });



const hasLiveKit = Boolean(

  process.env.NEXT_PUBLIC_LIVEKIT_URL

  && process.env.LIVEKIT_API_KEY

  && process.env.LIVEKIT_API_SECRET

  && !String(process.env.LIVEKIT_API_SECRET).includes('replace_with'),

);



test('LiveKit development smoke: ensureRoom + listParticipants + deleteRoom', async (t) => {

  if (!hasLiveKit) {

    t.skip('LiveKit credentials not configured — skipping AUTH-05 LiveKit smoke');

    return;

  }



  const roomName = `auth05-smoke-${Date.now().toString(36)}`;

  const api = createLiveKitRoomService({

    url: process.env.NEXT_PUBLIC_LIVEKIT_URL,

    apiKey: process.env.LIVEKIT_API_KEY,

    apiSecret: process.env.LIVEKIT_API_SECRET,

  });



  t.after(async () => {

    try {

      await api.deleteRoom(roomName);

    } catch {

      // best-effort cleanup

    }

  });



  const room = await api.ensureRoom(roomName);

  assert.equal(room.name, roomName);

  assert.equal(Number(room.maxParticipants), 6);



  const participants = await api.listParticipants(roomName);

  assert.equal(Array.isArray(participants), true);

  assert.equal(participants.length, 0);



  // removeParticipant on missing identity should surface as not found — do not call

  // against a live participant. deleteRoom closes the room for end-room behavior.

  await api.deleteRoom(roomName);

  const after = await api.listParticipants(roomName);

  assert.equal(after.length, 0);

});

