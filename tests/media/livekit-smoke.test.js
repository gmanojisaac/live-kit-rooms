/**
 * Optional LiveKit Cloud development smoke for Phase 3.
 * Skips unless LIVEKIT_API_KEY / LIVEKIT_API_SECRET / NEXT_PUBLIC_LIVEKIT_URL are set
 * and are not placeholders. Does not claim six-user acceptance.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaRoomOptions, MEDIA_QUALITY_POLICY_SUMMARY } from '../../lib/media/room-options.js';
import { ScreenSharePresets, VideoPresets } from 'livekit-client';

const key = process.env.LIVEKIT_API_KEY || '';
const secret = process.env.LIVEKIT_API_SECRET || '';
const url = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || '';
const configured = Boolean(
  key
  && secret
  && url
  && secret !== 'replace_me'
  && !secret.includes('your_'),
);

test('media room options enable adaptiveStream + dynacast with real presets', () => {
  const options = createMediaRoomOptions({ VideoPresets, ScreenSharePresets });
  assert.equal(options.adaptiveStream, true);
  assert.equal(options.dynacast, true);
  assert.equal(MEDIA_QUALITY_POLICY_SUMMARY.maxSimultaneousScreenShares, 6);
  assert.ok(options.publishDefaults?.screenShareEncoding);
});

test(
  'development LiveKit URL is configured for optional smoke',
  { skip: !configured },
  () => {
    assert.match(url, /^wss:\/\//i);
    assert.ok(key.length > 0);
    assert.ok(secret.length > 0);
  },
);
