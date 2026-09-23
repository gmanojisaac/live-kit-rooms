/**
 * LiveKit Cloud room helpers for capacity-backed join.
 */

import { RoomServiceClient } from 'livekit-server-sdk';
import { assertServerOnly } from '../security/server-only.js';
import { MAX_PARTICIPANTS } from '../rooms/policy.js';

function toHttpHost(livekitUrl) {
  if (typeof livekitUrl !== 'string' || !livekitUrl) {
    throw new Error('LiveKit URL is required');
  }
  return livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

function isNotFoundError(error) {
  const status = error?.status ?? error?.code;
  return status === 404 || status === 'not_found' || error?.code === 'not_found';
}

/**
 * Create a LiveKit RoomServiceClient wrapper.
 * Injectable for tests via `{ client }` override.
 */
export function createLiveKitRoomService({
  url,
  apiKey,
  apiSecret,
  client,
  maxParticipants = MAX_PARTICIPANTS,
} = {}) {
  assertServerOnly();

  const roomClient = client || new RoomServiceClient(
    toHttpHost(url),
    apiKey,
    apiSecret,
  );

  return {
    maxParticipants,

    /**
     * Ensure the LiveKit room exists with the six-person limit.
     * Room name must match the database room slug.
     */
    async ensureRoom(roomName) {
      let existing = null;
      try {
        const rooms = await roomClient.listRooms([roomName]);
        existing = rooms?.[0] || null;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }

      if (existing) {
        return existing;
      }

      return roomClient.createRoom({
        name: roomName,
        maxParticipants,
        emptyTimeout: 300,
        departureTimeout: 20,
      });
    },

    /**
     * Count currently connected participants (0 if room does not exist yet).
     */
    async countParticipants(roomName) {
      try {
        const participants = await roomClient.listParticipants(roomName);
        return Array.isArray(participants) ? participants.length : 0;
      } catch (error) {
        if (isNotFoundError(error)) return 0;
        throw error;
      }
    },

    /**
     * List connected participants (empty if room does not exist).
     */
    async listParticipants(roomName) {
      try {
        const participants = await roomClient.listParticipants(roomName);
        return Array.isArray(participants) ? participants : [];
      } catch (error) {
        if (isNotFoundError(error)) return [];
        throw error;
      }
    },

    /**
     * Disconnect a participant by LiveKit identity.
     * Uses revokeTokenTs so tokens issued before removal cannot reconnect.
     */
    async removeParticipant(roomName, identity, { now = Date.now } = {}) {
      const revokeTokenTs = BigInt(Math.floor(now() / 1000));
      await roomClient.removeParticipant(roomName, identity, { revokeTokenTs });
    },

    /**
     * Delete / close a LiveKit room (disconnects all participants).
     * Treats missing rooms as already closed.
     */
    async deleteRoom(roomName) {
      try {
        await roomClient.deleteRoom(roomName);
      } catch (error) {
        if (isNotFoundError(error)) return;
        throw error;
      }
    },
  };
}
