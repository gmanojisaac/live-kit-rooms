/**
 * Request helpers for Next.js Route Handlers (IP, base URL, cookies).
 */

import { createClientIpResolver, parseTrustedProxyIps } from '../security/rate-limit.js';
import { OWNER_SESSION_COOKIE } from '../security/owner-session.js';

export function getRequestBaseUrl(request, fallbackBaseUrl = '') {
  const envBase = typeof fallbackBaseUrl === 'string' ? fallbackBaseUrl.trim().replace(/\/$/, '') : '';
  if (envBase) return envBase;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || url.host;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto || url.protocol.replace(':', '') || 'https';
  return `${proto}://${host}`;
}

export function getCookieValue(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
}

export function getOwnerSessionToken(request) {
  return getCookieValue(request, OWNER_SESSION_COOKIE);
}

export function resolveClientIp(request, env = process.env) {
  const trusted = parseTrustedProxyIps(env.TRUSTED_PROXY_IPS || '');
  const resolver = createClientIpResolver({ trustedProxyIps: trusted });

  // NextRequest has no socket; use x-forwarded-for only when proxy trust is configured.
  const forwarded = request.headers.get('x-forwarded-for');
  const fakeReq = {
    socket: { remoteAddress: trusted.length ? (trusted[0] || '127.0.0.1') : (forwarded ? 'unknown' : '127.0.0.1') },
    headers: {
      'x-forwarded-for': forwarded || '',
    },
  };

  // When no trusted proxies: ignore X-Forwarded-For (secure default).
  if (trusted.length === 0) {
    // Prefer Vercel's platform IP header when present (set by the platform, not the client).
    const vercelForwarded = request.headers.get('x-real-ip');
    if (vercelForwarded) return resolver({ socket: { remoteAddress: vercelForwarded }, headers: {} });
    return 'unknown';
  }

  return resolver(fakeReq);
}
