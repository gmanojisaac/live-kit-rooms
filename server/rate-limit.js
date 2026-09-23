/**
 * Prototype rate-limit module — aligned with management policy (5 / 15 minutes).
 * Shared implementation lives in lib/security/rate-limit.js for the Next.js target.
 */

export {
  JOIN_RATE_LIMIT_MAX_FAILURES,
  JOIN_RATE_LIMIT_WINDOW_MS,
  normalizeIp,
  isValidIp,
  parseTrustedProxyIps,
  createClientIpResolver,
  clientIp,
  createJoinRateLimiter,
  createRateLimiter,
} from '../lib/security/rate-limit.js';
