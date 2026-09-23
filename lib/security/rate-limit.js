/**
 * Shared in-memory rate limiter (join failures + room creation).
 * Not shared across serverless isolates; still required for single-process and local abuse control.
 */

import {
  JOIN_RATE_LIMIT_MAX_FAILURES,
  JOIN_RATE_LIMIT_WINDOW_MS,
} from '../rooms/policy.js';

export {
  JOIN_RATE_LIMIT_MAX_FAILURES,
  JOIN_RATE_LIMIT_WINDOW_MS,
};

export function normalizeIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return 'unknown';
  let value = ip.trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  return value || 'unknown';
}

export function isValidIp(ip) {
  const value = normalizeIp(ip);
  if (!value || value === 'unknown') return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255;
    });
  }
  if (value.includes(':') && /^[0-9a-fA-F:]+$/.test(value)) return true;
  return false;
}

export function parseTrustedProxyIps(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',')
    .map((part) => normalizeIp(part))
    .filter((ip) => isValidIp(ip));
}

function parseForwardedFor(header) {
  if (typeof header !== 'string' || !header.trim()) return [];
  return header.split(',').map((part) => normalizeIp(part.trim()));
}

/**
 * Resolve the client IP for rate limiting.
 * - Without TRUSTED_PROXY_IPS: always use the TCP peer (ignore X-Forwarded-For).
 * - With a trusted immediate peer: walk X-Forwarded-For from the right, skipping
 *   trusted proxies, and take the first valid untrusted address as the client.
 */
export function createClientIpResolver({ trustedProxyIps = [] } = {}) {
  const trusted = new Set(
    (trustedProxyIps || []).map((ip) => normalizeIp(ip)).filter((ip) => isValidIp(ip)),
  );

  return function getClientIp(reqLike) {
    const peer = normalizeIp(
      reqLike?.socket?.remoteAddress
      || reqLike?.ip
      || '',
    );
    if (!trusted.has(peer)) return peer || 'unknown';

    const forwardedHeader = reqLike?.headers?.['x-forwarded-for']
      ?? reqLike?.headers?.get?.('x-forwarded-for');
    const forwarded = parseForwardedFor(
      Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : forwardedHeader,
    );
    for (let i = forwarded.length - 1; i >= 0; i -= 1) {
      const address = forwarded[i];
      if (!isValidIp(address)) continue;
      if (!trusted.has(address)) return address;
    }
    return peer || 'unknown';
  };
}

export const clientIp = createClientIpResolver();

export function createRateLimiter({
  maxFailures,
  windowMs,
  now = Date.now,
} = {}) {
  if (!Number.isFinite(maxFailures) || maxFailures <= 0) {
    throw new Error('maxFailures must be a positive number');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }

  /** @type {Map<string, number[]>} */
  const failures = new Map();

  function prune(ip, current) {
    const times = failures.get(ip);
    if (!times) return [];
    const recent = times.filter((time) => current - time < windowMs);
    if (recent.length === 0) failures.delete(ip);
    else failures.set(ip, recent);
    return recent;
  }

  function cleanup(current = now()) {
    for (const ip of [...failures.keys()]) prune(ip, current);
  }

  return {
    check(ip) {
      const current = now();
      cleanup(current);
      const recent = prune(ip, current);
      if (recent.length >= maxFailures) {
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - current) / 1000));
        return { limited: true, retryAfterSeconds };
      }
      return { limited: false, retryAfterSeconds: 0 };
    },
    recordFailure(ip) {
      const current = now();
      cleanup(current);
      const recent = prune(ip, current);
      recent.push(current);
      failures.set(ip, recent);
    },
    size() {
      return failures.size;
    },
    cleanup,
  };
}

/** Alias matching the prototype join limiter API. */
export function createJoinRateLimiter(options = {}) {
  return createRateLimiter({
    maxFailures: options.maxFailures ?? JOIN_RATE_LIMIT_MAX_FAILURES,
    windowMs: options.windowMs ?? JOIN_RATE_LIMIT_WINDOW_MS,
    now: options.now,
  });
}
