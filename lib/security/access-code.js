/**
 * Access-code hashing — password-derived hash with unique per-code salt.
 * Format: scrypt$N$r$p$<base64url-salt>$<base64url-hash>
 * Never store plaintext codes. Prefer Argon2id when an approved dependency is added.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { assertServerOnly } from './server-only.js';
import {
  MAX_ACCESS_CODE_LENGTH,
  MIN_ACCESS_CODE_LENGTH,
} from '../rooms/policy.js';

const scryptAsync = promisify(scryptCallback);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = 'scrypt';

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

export function validateAccessCodeFormat(code, {
  minLength = MIN_ACCESS_CODE_LENGTH,
  maxLength = MAX_ACCESS_CODE_LENGTH,
} = {}) {
  if (typeof code !== 'string') {
    return { ok: false, error: 'Access code is required.' };
  }
  if (code.length < minLength || code.length > maxLength) {
    return {
      ok: false,
      error: `Access code must be ${minLength}–${maxLength} characters.`,
    };
  }
  // Reject codes with leading/trailing whitespace (creators should not rely on trim).
  if (code.trim() !== code) {
    return { ok: false, error: 'Access code must not start or end with whitespace.' };
  }
  return { ok: true };
}

/**
 * @param {string} code
 * @returns {Promise<string>} encoded salt+hash for persistence
 */
export async function hashAccessCode(code) {
  assertServerOnly();
  const format = validateAccessCodeFormat(code);
  if (!format.ok) {
    throw new Error(format.error);
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(code, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join('$');
}

/**
 * Constant-time verify against a stored encoded hash.
 * @param {string} code
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyAccessCode(code, storedHash) {
  assertServerOnly();
  if (typeof code !== 'string' || typeof storedHash !== 'string') return false;

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isFinite(v) && v > 0)) return false;

  let salt;
  let expected;
  try {
    salt = fromBase64Url(parts[4]);
    expected = fromBase64Url(parts[5]);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await scryptAsync(code, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Extract salt material for equality tests (never log or return to clients).
 * @param {string} storedHash
 */
export function extractAccessCodeSaltForTests(storedHash) {
  const parts = typeof storedHash === 'string' ? storedHash.split('$') : [];
  return parts.length === 6 ? parts[4] : null;
}
