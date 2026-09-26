/**
 * Signed room-role tokens for creator-only joins and moderation actions.
 * These are app authorization tokens, not LiveKit grants.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertServerOnly } from './server-only.js';

const CREATOR_JOIN_PURPOSE = 'creator_join';
const MODERATOR_ACTION_PURPOSE = 'moderator_action';
const CREATOR_JOIN_TTL_MS = 30 * 60 * 1000;
const MODERATOR_ACTION_TTL_MS = 12 * 60 * 60 * 1000;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64urlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sign(payloadB64, secret) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('OWNER_SESSION_SECRET must be at least 32 characters');
  }
}

function createSignedToken(secret, payload) {
  assertServerOnly();
  assertSecret(secret);
  const payloadB64 = base64urlJson(payload);
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function verifySignedToken(token, secret, { purpose, ownerId, roomId, slug, now = Date.now } = {}) {
  assertServerOnly();
  if (typeof token !== 'string' || !token || typeof secret !== 'string' || secret.length < 32) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expected = sign(payloadB64, secret);
  if (!safeEqual(signature, expected)) return null;

  let payload;
  try {
    payload = parseBase64urlJson(payloadB64);
  } catch {
    return null;
  }

  if (!payload || payload.purpose !== purpose) return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now()) return null;
  if (payload.ownerId !== ownerId) return null;
  if (payload.roomId !== roomId) return null;
  if (payload.slug !== slug) return null;

  return payload;
}

export function createCreatorJoinToken({
  secret,
  ownerId,
  roomId,
  slug,
  now = Date.now,
  ttlMs = CREATOR_JOIN_TTL_MS,
}) {
  const iat = now();
  return createSignedToken(secret, {
    purpose: CREATOR_JOIN_PURPOSE,
    ownerId,
    roomId,
    slug,
    iat,
    exp: iat + ttlMs,
  });
}

export function verifyCreatorJoinToken(token, {
  secret,
  ownerId,
  roomId,
  slug,
  now = Date.now,
}) {
  return verifySignedToken(token, secret, {
    purpose: CREATOR_JOIN_PURPOSE,
    ownerId,
    roomId,
    slug,
    now,
  });
}

export function createModeratorActionToken({
  secret,
  ownerId,
  roomId,
  slug,
  participantIdentity,
  expiresAt,
  now = Date.now,
}) {
  const iat = now();
  const expiresMs = Date.parse(expiresAt);
  const exp = Number.isFinite(expiresMs)
    ? Math.min(expiresMs, iat + MODERATOR_ACTION_TTL_MS)
    : iat + MODERATOR_ACTION_TTL_MS;

  return createSignedToken(secret, {
    purpose: MODERATOR_ACTION_PURPOSE,
    ownerId,
    roomId,
    slug,
    participantIdentity,
    iat,
    exp,
  });
}

export function verifyModeratorActionToken(token, {
  secret,
  ownerId,
  roomId,
  slug,
  now = Date.now,
}) {
  const payload = verifySignedToken(token, secret, {
    purpose: MODERATOR_ACTION_PURPOSE,
    ownerId,
    roomId,
    slug,
    now,
  });
  if (!payload || typeof payload.participantIdentity !== 'string' || !payload.participantIdentity) {
    return null;
  }
  return payload;
}
