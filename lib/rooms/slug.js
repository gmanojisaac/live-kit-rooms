import { randomBytes } from 'node:crypto';
import { assertServerOnly } from '../security/server-only.js';

/**
 * Generates Google Meet-style slug: abc-defg-hijk
 */
export function generateRoomSlug() {
  assertServerOnly();
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const getSeg = (len) => {
    let s = '';
    const bytes = randomBytes(len);
    for (let i = 0; i < len; i += 1) {
      s += chars[bytes[i] % chars.length];
    }
    return s;
  };
  return `${getSeg(3)}-${getSeg(4)}-${getSeg(4)}`;
}

export function isValidRoomSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]{3,64}$/.test(slug);
}
