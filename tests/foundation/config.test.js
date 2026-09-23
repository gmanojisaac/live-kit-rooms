import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPublicConfig,
  getServerConfig,
  assertPublicPrivateSeparation,
  ConfigError,
  ENV_CATALOG,
} from '../../lib/config/env.js';

const completeEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_LIVEKIT_URL: 'wss://example.livekit.cloud',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  LIVEKIT_API_KEY: 'api-key',
  LIVEKIT_API_SECRET: 'api-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OWNER_SESSION_SECRET: 'production-owner-session-secret-32c',
};

test('getPublicConfig only returns public fields', () => {
  const publicConfig = getPublicConfig(completeEnv);
  assert.equal(publicConfig.livekitUrl, completeEnv.NEXT_PUBLIC_LIVEKIT_URL);
  assert.equal(publicConfig.supabaseUrl, completeEnv.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(publicConfig.supabaseAnonKey, completeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  assert.equal('livekitApiSecret' in publicConfig, false);
  assert.equal('supabaseServiceRoleKey' in publicConfig, false);
});

test('getServerConfig fails clearly when production secrets are missing', () => {
  assert.throws(
    () => getServerConfig({ NODE_ENV: 'production' }, { requireProductionSecrets: true }),
    (error) => error instanceof ConfigError && /Missing required environment variable/.test(error.message),
  );
});

test('getServerConfig succeeds with a complete production inventory', () => {
  const config = getServerConfig(completeEnv, { requireProductionSecrets: true });
  assert.equal(config.livekitApiKey, 'api-key');
  assert.equal(config.livekitApiSecret, 'api-secret');
  assert.equal(config.supabaseServiceRoleKey, 'service-role-key');
  assert.equal(config.ownerSessionSecret, 'production-owner-session-secret-32c');
  assert.equal(config.isProduction, true);
  assert.equal(config.roomPolicy.defaultExpiryMinutes, 90);
  assert.equal(config.roomPolicy.livekitTokenTtlSeconds, 3600);
});

test('public aliases for owner session secrets are rejected', () => {
  assert.throws(
    () => getServerConfig({
      ...completeEnv,
      NEXT_PUBLIC_OWNER_SESSION_SECRET: 'leaked',
    }),
    (error) => error instanceof ConfigError && /NEXT_PUBLIC_OWNER_SESSION_SECRET is forbidden/.test(error.message),
  );
});

test('public aliases for server secrets are rejected', () => {
  assert.throws(
    () => getServerConfig({
      ...completeEnv,
      NEXT_PUBLIC_LIVEKIT_API_SECRET: 'leaked',
    }),
    (error) => error instanceof ConfigError && /NEXT_PUBLIC_LIVEKIT_API_SECRET is forbidden/.test(error.message),
  );

  assert.throws(
    () => assertPublicPrivateSeparation({
      NEXT_PUBLIC_LIVEKIT_API_SECRET: 'nope',
    }),
    ConfigError,
  );
});

test('ENV_CATALOG keeps public and server keys disjoint', () => {
  const overlap = ENV_CATALOG.public.filter((key) => ENV_CATALOG.server.includes(key));
  assert.deepEqual(overlap, []);
  assert.ok(ENV_CATALOG.server.includes('LIVEKIT_API_SECRET'));
  assert.ok(ENV_CATALOG.public.includes('NEXT_PUBLIC_LIVEKIT_URL'));
  assert.equal(ENV_CATALOG.public.includes('LIVEKIT_API_SECRET'), false);
});
