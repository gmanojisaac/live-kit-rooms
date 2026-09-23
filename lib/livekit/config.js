/**
 * LiveKit configuration boundary.
 * Token minting lives in lib/livekit/token.js; room capacity APIs in lib/livekit/rooms.js.
 * API key/secret must never be imported into Client Components.
 */

import { getPublicConfig, getServerConfig } from '../config/env.js';

export function getLiveKitBrowserConfig(env = process.env) {
  const { livekitUrl } = getPublicConfig(env);
  return { url: livekitUrl };
}

export function getLiveKitServerConfig(env = process.env, options) {
  const config = getServerConfig(env, options);
  return {
    url: config.livekitUrl,
    apiKey: config.livekitApiKey,
    apiSecret: config.livekitApiSecret,
    tokenTtlSeconds: config.roomPolicy.livekitTokenTtlSeconds,
  };
}
