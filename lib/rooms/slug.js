/**
 * Non-sensitive, URL-safe room slug generation.
 * Slugs are identifiers only — never derived from access codes or invite tokens.
 */

import { randomBytes } from 'node:crypto';
import { assertServerOnly } from '../security/server-only.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * @param {number} [byteLength=9] ~72 bits of entropy encoded to ~12 chars
 */
export function generateRoomSlug(byteLength = 9) {
  assertServerOnly();
  const bytes = randomBytes(byteLength);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function isValidRoomSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]{8,64}$/.test(slug);
}
