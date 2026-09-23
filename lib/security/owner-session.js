/**
 * Owner identity session — signed, HttpOnly cookie foundation for AUTH-05.
 * Owner id is server-issued; never accept owner_id from the browser body.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertServerOnly } from './server-only.js';
import {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_TTL_MS,
} from '../rooms/policy.js';

export { OWNER_SESSION_COOKIE, OWNER_SESSION_TTL_MS };

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

/**
 * @param {string} secret
 * @param {{ ownerId?: string, now?: () => number, ttlMs?: number }} [options]
 */
export function createOwnerSession(secret, options = {}) {
  assertServerOnly();
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('OWNER_SESSION_SECRET must be at least 32 characters');
  }
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? OWNER_SESSION_TTL_MS;
  const iat = now();
  const payload = {
    ownerId: options.ownerId || randomUUID(),
    iat,
    exp: iat + ttlMs,
  };
  const payloadB64 = base64urlJson(payload);
  const sig = sign(payloadB64, secret);
  return {
    ownerId: payload.ownerId,
    token: `${payloadB64}.${sig}`,
    expiresAt: payload.exp,
  };
}

/**
 * @param {string} token
 * @param {string} secret
 * @param {{ now?: () => number }} [options]
 * @returns {{ ownerId: string, exp: number, iat: number } | null}
 */
export function verifyOwnerSession(token, secret, options = {}) {
  assertServerOnly();
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) {
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
  if (!payload || typeof payload.ownerId !== 'string' || !payload.ownerId) return null;
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;

  const now = options.now || Date.now;
  if (payload.exp <= now()) return null;

  return {
    ownerId: payload.ownerId,
    exp: payload.exp,
    iat: payload.iat,
  };
}

export function ownerSessionCookieOptions({ isProduction, maxAgeSeconds }) {
  return {
    httpOnly: true,
    secure: Boolean(isProduction),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function readOwnerSessionFromCookieHeader(cookieHeader, secret, options = {}) {
  assertServerOnly();
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OWNER_SESSION_COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(OWNER_SESSION_COOKIE.length + 1));
  return verifyOwnerSession(token, secret, options);
}
