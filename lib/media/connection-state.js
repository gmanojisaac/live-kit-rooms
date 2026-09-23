/**
 * Map LiveKit ConnectionState (+ app-level failure) to user-facing UI.
 * Uses livekit-client string values; no timers.
 */

export const UI_CONNECTION = Object.freeze({
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
});

const LABEL = Object.freeze({
  [UI_CONNECTION.CONNECTING]: 'Connecting…',
  [UI_CONNECTION.CONNECTED]: 'Connected',
  [UI_CONNECTION.RECONNECTING]: 'Reconnecting…',
  [UI_CONNECTION.DISCONNECTED]: 'Connection lost',
  [UI_CONNECTION.FAILED]: 'Connection failed',
});

/**
 * @param {string} livekitState - ConnectionState from livekit-client
 * @param {{ failed?: boolean }} [opts]
 * @returns {typeof UI_CONNECTION[keyof typeof UI_CONNECTION]}
 */
export function mapConnectionState(livekitState, opts = {}) {
  if (opts.failed) return UI_CONNECTION.FAILED;

  switch (livekitState) {
    case 'connecting':
      return UI_CONNECTION.CONNECTING;
    case 'connected':
      return UI_CONNECTION.CONNECTED;
    case 'reconnecting':
    case 'signalReconnecting':
      return UI_CONNECTION.RECONNECTING;
    case 'disconnected':
    default:
      return UI_CONNECTION.DISCONNECTED;
  }
}

/**
 * @param {string} uiState
 * @returns {string}
 */
export function connectionStateLabel(uiState) {
  return LABEL[uiState] || LABEL[UI_CONNECTION.DISCONNECTED];
}

/**
 * User-facing leave / disconnect reasons (no raw SDK enums in UI).
 * @param {number|string|undefined} reason - DisconnectReason
 * @returns {{ kind: string, message: string }}
 */
export function mapDisconnectReason(reason) {
  const code = typeof reason === 'number' ? reason : undefined;

  // livekit DisconnectReason numeric values
  if (code === 4) {
    return {
      kind: 'removed',
      message: 'You were removed from this room by the owner.',
    };
  }
  if (code === 5 || code === 10) {
    return {
      kind: 'ended',
      message: 'This room has ended.',
    };
  }
  if (code === 1) {
    return {
      kind: 'left',
      message: 'You left the room.',
    };
  }
  if (code === 2) {
    return {
      kind: 'duplicate',
      message: 'Another session joined with the same identity. This connection was closed.',
    };
  }
  if (code === 7 || code === 14 || code === 15) {
    return {
      kind: 'failed',
      message: 'Could not stay connected. Check your network and try joining again.',
    };
  }

  return {
    kind: 'disconnected',
    message: 'Connection lost. You can try joining again.',
  };
}

/**
 * Whether the local connection quality warrants a user-facing warning.
 * @param {string} quality - ConnectionQuality from livekit-client
 */
export function isPoorNetworkQuality(quality) {
  return quality === 'poor' || quality === 'lost';
}

export const POOR_NETWORK_MESSAGE =
  'Your connection appears unstable. Some screen shares may temporarily reduce quality.';
