// In-memory join abuse limiter for the single application server.
// Not shared across processes.

export const JOIN_RATE_LIMIT_MAX_FAILURES = 10;
export const JOIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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
    return value.split('.').every(part => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255;
    });
  }
  // Compact/full IPv6 (normalized forms without zone id).
  if (value.includes(':') && /^[0-9a-fA-F:]+$/.test(value)) return true;
  return false;
}

export function parseTrustedProxyIps(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',')
    .map(part => normalizeIp(part))
    .filter(ip => isValidIp(ip));
}

function parseForwardedFor(header) {
  if (typeof header !== 'string' || !header.trim()) return [];
  return header.split(',').map(part => normalizeIp(part.trim()));
}

/**
 * Resolve the client IP for rate limiting.
 * - Without TRUSTED_PROXY_IPS: always use the TCP peer (ignore X-Forwarded-For).
 * - With a trusted immediate peer: walk X-Forwarded-For from the right, skipping
 *   trusted proxies, and take the first valid untrusted address as the client.
 */
export function createClientIpResolver({ trustedProxyIps = [] } = {}) {
  const trusted = new Set(
    (trustedProxyIps || []).map(ip => normalizeIp(ip)).filter(ip => isValidIp(ip)),
  );

  return function getClientIp(req) {
    const peer = normalizeIp(req.socket?.remoteAddress || '');
    if (!trusted.has(peer)) return peer || 'unknown';

    const forwarded = parseForwardedFor(req.headers?.['x-forwarded-for']);
    for (let i = forwarded.length - 1; i >= 0; i -= 1) {
      const address = forwarded[i];
      if (!isValidIp(address)) continue;
      if (!trusted.has(address)) return address;
    }
    return peer || 'unknown';
  };
}

// Secure default: no trusted proxies, so forged X-Forwarded-For is ignored.
export const clientIp = createClientIpResolver();

export function createJoinRateLimiter({
  maxFailures = JOIN_RATE_LIMIT_MAX_FAILURES,
  windowMs = JOIN_RATE_LIMIT_WINDOW_MS,
  now = Date.now,
} = {}) {
  /** @type {Map<string, number[]>} */
  const failures = new Map();

  function prune(ip, current) {
    const times = failures.get(ip);
    if (!times) return [];
    const recent = times.filter(time => current - time < windowMs);
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
