import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapConnectionState,
  connectionStateLabel,
  mapDisconnectReason,
  isPoorNetworkQuality,
  UI_CONNECTION,
} from '../../lib/media/connection-state.js';
import {
  resolveFocusId,
  nextFocusAfterTrackChange,
  shouldHandleEscapeToGrid,
  selectFocusTarget,
  clearFocus,
} from '../../lib/media/focus-state.js';
import {
  isLocalScreenSharing,
  shareStateLabel,
  mapScreenShareTiles,
  mapParticipantPresence,
  SIX_PERSON_EMPTY_SHARE_COPY,
} from '../../lib/media/screen-share-state.js';
import {
  qualityModeForTrack,
  videoQualityForMode,
  buildQualityPlan,
  QUALITY_MODE,
} from '../../lib/media/quality-policy.js';
import { createMediaRoomOptions, MEDIA_QUALITY_POLICY_SUMMARY } from '../../lib/media/room-options.js';
import { sanitizeMediaDiagnostics } from '../../lib/media/diagnostics.js';

test('mapConnectionState covers LiveKit connection lifecycle', () => {
  assert.equal(mapConnectionState('connecting'), UI_CONNECTION.CONNECTING);
  assert.equal(mapConnectionState('connected'), UI_CONNECTION.CONNECTED);
  assert.equal(mapConnectionState('reconnecting'), UI_CONNECTION.RECONNECTING);
  assert.equal(mapConnectionState('signalReconnecting'), UI_CONNECTION.RECONNECTING);
  assert.equal(mapConnectionState('disconnected'), UI_CONNECTION.DISCONNECTED);
  assert.equal(mapConnectionState('connected', { failed: true }), UI_CONNECTION.FAILED);
  assert.equal(connectionStateLabel(UI_CONNECTION.RECONNECTING), 'Reconnecting…');
});

test('mapDisconnectReason stays user-facing', () => {
  assert.equal(mapDisconnectReason(4).kind, 'removed');
  assert.equal(mapDisconnectReason(5).kind, 'ended');
  assert.equal(mapDisconnectReason(1).kind, 'left');
  assert.match(mapDisconnectReason(14).message, /network|joining/i);
});

test('poor network detection uses LiveKit quality strings', () => {
  assert.equal(isPoorNetworkQuality('poor'), true);
  assert.equal(isPoorNetworkQuality('lost'), true);
  assert.equal(isPoorNetworkQuality('good'), false);
});

test('focus helpers: Escape, clear, and missing track recovery', () => {
  assert.equal(resolveFocusId('a', ['a', 'b']), 'a');
  assert.equal(resolveFocusId('z', ['a', 'b']), null);
  assert.equal(nextFocusAfterTrackChange('a', [{ id: 'b' }]), null);
  assert.equal(nextFocusAfterTrackChange('a', [{ id: 'a' }]), 'a');
  assert.equal(selectFocusTarget(null, 'x'), 'x');
  assert.equal(clearFocus(), null);

  assert.equal(shouldHandleEscapeToGrid({ key: 'Escape', target: { tagName: 'DIV' } }, 'tid'), true);
  assert.equal(shouldHandleEscapeToGrid({ key: 'Escape', target: { tagName: 'TEXTAREA' } }, 'tid'), false);
  assert.equal(shouldHandleEscapeToGrid({ key: 'Escape', target: { tagName: 'INPUT' } }, 'tid'), false);
  assert.equal(shouldHandleEscapeToGrid({ key: 'Escape' }, null), false);
  assert.equal(shouldHandleEscapeToGrid({ key: 'Enter' }, 'tid'), false);
});

test('screen-share mapping and six-person empty copy', () => {
  assert.equal(isLocalScreenSharing({ isScreenShareEnabled: true }), true);
  assert.equal(shareStateLabel(false), 'Not sharing');
  assert.match(SIX_PERSON_EMPTY_SHARE_COPY, /six people/i);
  assert.doesNotMatch(SIX_PERSON_EMPTY_SHARE_COPY, /Both participants/i);

  const tiles = mapScreenShareTiles([
    {
      publication: { trackSid: 'tr_1' },
      participant: { identity: 'id1', name: 'Arjun', isLocal: true, isSpeaking: true },
    },
  ]);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].displayName, 'Arjun');
  assert.equal(tiles[0].isSharing, true);

  const presence = mapParticipantPresence([
    { identity: 'a', name: 'Akshay', isScreenShareEnabled: false },
  ]);
  assert.equal(presence[0].shareLabel, 'Not sharing');
});

test('quality policy prefers focused HIGH and grid LOW', () => {
  assert.equal(qualityModeForTrack('a', 'a'), QUALITY_MODE.FOCUSED);
  assert.equal(qualityModeForTrack('b', 'a'), QUALITY_MODE.GRID);
  assert.equal(qualityModeForTrack('b', 'a', { isVisible: false }), QUALITY_MODE.HIDDEN);
  assert.equal(videoQualityForMode(QUALITY_MODE.FOCUSED), 2);
  assert.equal(videoQualityForMode(QUALITY_MODE.GRID), 0);

  const plan = buildQualityPlan(['a', 'b'], 'a');
  assert.equal(plan.find((p) => p.trackId === 'a').mode, QUALITY_MODE.FOCUSED);
  assert.equal(plan.find((p) => p.trackId === 'b').enabled, false);
});

test('room options explicitly enable adaptiveStream and dynacast', () => {
  const options = createMediaRoomOptions({
    ScreenSharePresets: {
      h360fps3: { encoding: { maxBitrate: 1 }, resolution: { width: 640, height: 360 } },
      h720fps15: { encoding: { maxBitrate: 2 }, resolution: { width: 1280, height: 720 } },
    },
  });
  assert.equal(options.adaptiveStream, true);
  assert.equal(options.dynacast, true);
  assert.equal(options.publishDefaults.simulcast, true);
  assert.equal(MEDIA_QUALITY_POLICY_SUMMARY.cameraDefault, 'off');
});

test('diagnostics sanitize focused id and omit secrets', () => {
  const snap = sanitizeMediaDiagnostics({
    connectionState: 'connected',
    focusedTrackId: 'TR_SECRETISH',
    participantCount: 3,
    screenShareCount: 2,
    reconnectCount: 1,
    networkQuality: 'good',
    dynacast: true,
    adaptiveStream: true,
  });
  assert.equal(snap.focusedTrackId, 'set');
  assert.equal(snap.participantCount, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, 'token'), false);
});
