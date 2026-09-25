/**
 * Log / string redaction for secrets and invitation material.
 */

const SENSITIVE_KEYS = new Set([
  'accesscode',
  'access_code',
  'code',
  'codehash',
  'code_hash',
  'rawinvitetoken',
  'raw_invite_token',
  'invitetoken',
  'invite_token',
  'token',
  'tokenhash',
  'token_hash',
  'ownersession',
  'owner_session',
  'session',
  'authorization',
  'cookie',
  'livekitapisecret',
  'livekit_api_secret',
  'supabaseservicerolekey',
  'supabase_service_role_key',
  'roomcreationsecret',
  'room_creation_secret',
  'ownersessionsecret',
  'owner_session_secret',
  'rejointoken',
  'rejoin_token',
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Redact invite query params from a URL string.
 */
export function redactUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  // Only rewrite values that look like URLs or path+query strings with sensitive params.
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) && !url.includes('?') && !url.startsWith('/')) {
    return url;
  }
  try {
    const parsed = new URL(url, 'http://localhost');
    for (const key of [...parsed.searchParams.keys()]) {
      if (/invite|token|code|access/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    // Preserve relative-ish forms when input had no origin.
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:invite|token|accessCode|access_code)=)[^&]*/gi, '$1[redacted]');
  }
}

/**
 * Deep-ish redact of objects destined for logs/audit (shallow + one nested level).
 */
export function redactForLog(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactUrl(value);
  if (typeof value !== 'object') return value;
  if (depth > 3) return '[truncated]';

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(normalizeKey(key))) {
      out[key] = '[redacted]';
    } else if (typeof entry === 'string' && /invite=/.test(entry)) {
      out[key] = redactUrl(entry);
    } else {
      out[key] = redactForLog(entry, depth + 1);
    }
  }
  return out;
}
