/**
 * Cryptographically random invitation tokens.
 * Raw token: base64url(32 random bytes) — 256 bits.
 * Persisted value: SHA-256(raw token) hex — never store the raw token.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertServerOnly } from './server-only.js';

export const INVITE_TOKEN_BYTES = 32;

export function generateInviteToken() {
  assertServerOnly();
  const rawToken = randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
  return {
    rawToken,
    tokenHash: hashInviteToken(rawToken),
  };
}

export function hashInviteToken(rawToken) {
  assertServerOnly();
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    throw new Error('Invite token is required');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function inviteTokensEqual(leftHash, rightHash) {
  if (typeof leftHash !== 'string' || typeof rightHash !== 'string') return false;
  const a = Buffer.from(leftHash);
  const b = Buffer.from(rightHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
