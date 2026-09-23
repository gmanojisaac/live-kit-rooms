/**
 * Central environment configuration.
 * Server code should import from here instead of reading process.env ad hoc.
 * Do not import this module from Client Components when requesting server secrets.
 */

import { getRoomPolicy } from '../rooms/policy.js';

const PUBLIC_KEYS = Object.freeze([
  'NEXT_PUBLIC_LIVEKIT_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]);

const SERVER_KEYS = Object.freeze([
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OWNER_SESSION_SECRET',
  'ROOM_CREATION_SECRET',
]);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function read(name, env) {
  // Next.js only reliably exposes server secrets via static process.env.NAME access.
  // Dynamic env[name] / passing process.env through can yield empty values at runtime.
  let value;
  if (env === process.env) {
    switch (name) {
      case 'NEXT_PUBLIC_LIVEKIT_URL': value = process.env.NEXT_PUBLIC_LIVEKIT_URL; break;
      case 'NEXT_PUBLIC_SUPABASE_URL': value = process.env.NEXT_PUBLIC_SUPABASE_URL; break;
      case 'NEXT_PUBLIC_SUPABASE_ANON_KEY': value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; break;
      case 'LIVEKIT_API_KEY': value = process.env.LIVEKIT_API_KEY; break;
      case 'LIVEKIT_API_SECRET': value = process.env.LIVEKIT_API_SECRET; break;
      case 'SUPABASE_SERVICE_ROLE_KEY': value = process.env.SUPABASE_SERVICE_ROLE_KEY; break;
      case 'OWNER_SESSION_SECRET': value = process.env.OWNER_SESSION_SECRET; break;
      case 'ROOM_CREATION_SECRET': value = process.env.ROOM_CREATION_SECRET; break;
      case 'APP_BASE_URL': value = process.env.APP_BASE_URL; break;
      case 'TRUSTED_PROXY_IPS': value = process.env.TRUSTED_PROXY_IPS; break;
      case 'NODE_ENV': value = process.env.NODE_ENV; break;
      case 'NEXT_PUBLIC_LIVEKIT_API_SECRET': value = process.env.NEXT_PUBLIC_LIVEKIT_API_SECRET; break;
      case 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY': value = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY; break;
      case 'NEXT_PUBLIC_OWNER_SESSION_SECRET': value = process.env.NEXT_PUBLIC_OWNER_SESSION_SECRET; break;
      case 'NEXT_PUBLIC_ROOM_CREATION_SECRET': value = process.env.NEXT_PUBLIC_ROOM_CREATION_SECRET; break;
      default: value = env[name]; break;
    }
  } else {
    value = env[name];
  }
  if (typeof value !== 'string') return '';
  return value.trim();
}

function requireValue(name, env) {
  const value = read(name, env);
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Public (browser-safe) settings only.
 * Safe to expose via NEXT_PUBLIC_* and to Client Components.
 */
export function getPublicConfig(env = process.env) {
  return {
    livekitUrl: read('NEXT_PUBLIC_LIVEKIT_URL', env),
    supabaseUrl: read('NEXT_PUBLIC_SUPABASE_URL', env),
    supabaseAnonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY', env),
  };
}

/**
 * Full server configuration. Never call from client bundles.
 * In production, required secrets must be present or this throws.
 */
export function getServerConfig(env = process.env, { requireProductionSecrets = false } = {}) {
  if (typeof window !== 'undefined') {
    throw new ConfigError('getServerConfig must not be called in the browser');
  }

  const nodeEnv = read('NODE_ENV', env) || 'development';
  const isProduction = nodeEnv === 'production' || requireProductionSecrets;

  const publicConfig = getPublicConfig(env);

  const livekitApiKey = read('LIVEKIT_API_KEY', env);
  const livekitApiSecret = read('LIVEKIT_API_SECRET', env);
  const supabaseServiceRoleKey = read('SUPABASE_SERVICE_ROLE_KEY', env);
  const ownerSessionSecret = read('OWNER_SESSION_SECRET', env);
  const roomCreationSecret = read('ROOM_CREATION_SECRET', env);
  const appBaseUrl = read('APP_BASE_URL', env).replace(/\/$/, '');
  const trustedProxyIps = read('TRUSTED_PROXY_IPS', env);

  if (isProduction) {
    requireValue('NEXT_PUBLIC_LIVEKIT_URL', env);
    requireValue('NEXT_PUBLIC_SUPABASE_URL', env);
    requireValue('NEXT_PUBLIC_SUPABASE_ANON_KEY', env);
    requireValue('LIVEKIT_API_KEY', env);
    requireValue('LIVEKIT_API_SECRET', env);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env);
    requireValue('OWNER_SESSION_SECRET', env);
  }

  // Guard against accidentally publishing secrets.
  if (read('NEXT_PUBLIC_LIVEKIT_API_SECRET', env)) {
    throw new ConfigError(
      'NEXT_PUBLIC_LIVEKIT_API_SECRET is forbidden. Keep LIVEKIT_API_SECRET server-only.',
    );
  }
  if (read('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY', env)) {
    throw new ConfigError(
      'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is forbidden. Keep SUPABASE_SERVICE_ROLE_KEY server-only.',
    );
  }
  if (read('NEXT_PUBLIC_OWNER_SESSION_SECRET', env)) {
    throw new ConfigError(
      'NEXT_PUBLIC_OWNER_SESSION_SECRET is forbidden. Keep OWNER_SESSION_SECRET server-only.',
    );
  }
  if (read('NEXT_PUBLIC_ROOM_CREATION_SECRET', env)) {
    throw new ConfigError(
      'NEXT_PUBLIC_ROOM_CREATION_SECRET is forbidden. Keep ROOM_CREATION_SECRET server-only.',
    );
  }

  const roomPolicy = getRoomPolicy(env);

  return {
    ...publicConfig,
    nodeEnv,
    isProduction,
    livekitApiKey,
    livekitApiSecret,
    supabaseServiceRoleKey,
    ownerSessionSecret,
    roomCreationSecret,
    appBaseUrl,
    trustedProxyIps,
    roomPolicy,
  };
}

export function assertPublicPrivateSeparation(env = process.env) {
  for (const key of SERVER_KEYS) {
    const publicAlias = `NEXT_PUBLIC_${key}`;
    if (read(publicAlias, env)) {
      throw new ConfigError(`${publicAlias} must not be set. Use server-only ${key}.`);
    }
  }
  return true;
}

export const ENV_CATALOG = Object.freeze({
  public: PUBLIC_KEYS,
  server: SERVER_KEYS,
  /**
   * Provisional policy knobs (D-02 / D-03 / D-04). Defaults are recommendations only.
   */
  roomPolicy: Object.freeze([
    'ROOM_DEFAULT_EXPIRY_MINUTES',
    'ROOM_CREATION_MODE',
    'ROOM_CREATION_SECRET',
    'OWNER_SESSION_SECRET',
    'INVITE_DEFAULT_MAX_USES',
    'ROOM_CREATION_RATE_LIMIT_MAX',
    'ROOM_CREATION_RATE_LIMIT_WINDOW_MS',
    'JOIN_RATE_LIMIT_MAX_FAILURES',
    'JOIN_RATE_LIMIT_WINDOW_MS',
    'LIVEKIT_TOKEN_TTL_SECONDS',
    'APP_BASE_URL',
    'TRUSTED_PROXY_IPS',
  ]),
});
