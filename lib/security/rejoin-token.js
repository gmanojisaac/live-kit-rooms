/**
 * Cryptographically random participant rejoin tokens.
 * Raw token: base64url(32 random bytes) — 256 bits.
 * Persisted value: SHA-256(raw token) hex — never store the raw token.
 */

import { generateInviteToken, hashInviteToken } from './invite-token.js';
import { assertServerOnly } from './server-only.js';

export const REJOIN_TOKEN_BYTES = 32;

export function generateRejoinToken() {
  assertServerOnly();
  return generateInviteToken();
}

export function hashRejoinToken(rawToken) {
  assertServerOnly();
  return hashInviteToken(rawToken);
}

export function isPlausibleRejoinToken(rawToken) {
  return typeof rawToken === 'string'
    && rawToken.length >= 16
    && rawToken.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(rawToken);
}
