/**
 * Short-lived, room-scoped LiveKit participant JWT minting (AUTH-04).
 * Credentials must never reach Client Components.
 */

import { AccessToken, RoomConfiguration, TokenVerifier } from 'livekit-server-sdk';
import { assertServerOnly } from '../security/server-only.js';
import {
  MAX_PARTICIPANTS,
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} from '../rooms/policy.js';

export {
  DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  MIN_LIVEKIT_TOKEN_TTL_SECONDS,
};

/**
 * Compute absolute JWT expiry capped by remaining room lifetime.
 * @returns {{ ok: true, expiresAt: Date, ttlSeconds: number } | { ok: false, reason: string }}
 */
export function computeTokenExpiry({
  now = Date.now,
  roomExpiresAt,
  configuredTtlSeconds = DEFAULT_LIVEKIT_TOKEN_TTL_SECONDS,
  minTtlSeconds = MIN_LIVEKIT_TOKEN_TTL_SECONDS,
} = {}) {
  const roomMs = typeof roomExpiresAt === 'number'
    ? roomExpiresAt
    : Date.parse(roomExpiresAt);
  if (!Number.isFinite(roomMs)) {
    return { ok: false, reason: 'ROOM_EXPIRED' };
  }

  const remainingRoomSeconds = Math.floor((roomMs - now()) / 1000);
  if (remainingRoomSeconds < minTtlSeconds) {
    return { ok: false, reason: 'ROOM_EXPIRED' };
  }

  const ttlSeconds = Math.min(
    Math.max(1, configuredTtlSeconds),
    remainingRoomSeconds,
  );
  const expiresAtMs = Math.min(now() + ttlSeconds * 1000, roomMs);
  return {
    ok: true,
    expiresAt: new Date(expiresAtMs),
    ttlSeconds,
  };
}

/**
 * Mint a participant AccessToken with minimum media grants.
 * Uses absolute expiry so the JWT cannot outlive the room.
 */
export async function createParticipantAccessToken({
  apiKey,
  apiSecret,
  identity,
  displayName,
  roomName,
  expiresAt,
  maxParticipants = MAX_PARTICIPANTS,
}) {
  assertServerOnly();

  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit API credentials are required to mint tokens');
  }
  if (!identity || !roomName || !(expiresAt instanceof Date)) {
    throw new Error('identity, roomName, and expiresAt Date are required');
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: expiresAt,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  token.roomConfig = new RoomConfiguration({
    name: roomName,
    maxParticipants,
    departureTimeout: 20,
  });

  return token.toJwt();
}

/**
 * Verify a participant JWT with server credentials (tests / diagnostics).
 */
export async function verifyParticipantAccessToken(token, { apiKey, apiSecret }) {
  assertServerOnly();
  const verifier = new TokenVerifier(apiKey, apiSecret);
  return verifier.verify(token);
}
