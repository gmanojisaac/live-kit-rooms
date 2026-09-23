'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import {
  ConnectionState,
  DisconnectReason,
  ScreenSharePresets,
  VideoPresets,
} from 'livekit-client';
import '@livekit/components-styles';
import { RoomWorkspace } from './RoomWorkspace.jsx';
import { ConnectionStatus } from './ConnectionStatus.jsx';
import { createMediaRoomOptions } from '@/lib/media/room-options.js';
import { mapDisconnectReason } from '@/lib/media/connection-state.js';

/**
 * LiveKit connection shell for /room/[slug] (MED-01 … MED-08).
 *
 * Token + URL come from POST /api/rooms/[slug]/join — never from env secrets.
 * Camera and mic default off unless the lobby preview toggles were enabled.
 */
export function MediaRoom({
  admission,
  roomMeta,
  onSessionEnd,
  initialVideo = false,
  initialAudio = false,
}) {
  const [connect, setConnect] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const prevStateRef = useRef(ConnectionState.Disconnected);
  const intentionalLeaveRef = useRef(false);

  const options = useMemo(
    () => createMediaRoomOptions({ VideoPresets, ScreenSharePresets }),
    [],
  );

  const token = admission?.token;
  const serverUrl = admission?.livekitUrl;

  const handleConnected = useCallback(() => {
    setFailed(false);
    setSessionMessage('');
    if (
      prevStateRef.current === ConnectionState.Reconnecting
      || prevStateRef.current === ConnectionState.SignalReconnecting
    ) {
      setReconnectCount((n) => n + 1);
    }
    prevStateRef.current = ConnectionState.Connected;
  }, []);

  const handleDisconnected = useCallback((reason) => {
    prevStateRef.current = ConnectionState.Disconnected;

    if (intentionalLeaveRef.current) {
      intentionalLeaveRef.current = false;
      onSessionEnd?.({ kind: 'left' });
      return;
    }

    const mapped = mapDisconnectReason(reason);
    if (
      reason === DisconnectReason.PARTICIPANT_REMOVED
      || reason === DisconnectReason.ROOM_DELETED
      || reason === DisconnectReason.ROOM_CLOSED
    ) {
      setSessionMessage(mapped.message);
      onSessionEnd?.({ kind: mapped.kind, message: mapped.message });
      return;
    }

    if (reason === DisconnectReason.CLIENT_INITIATED) {
      onSessionEnd?.({ kind: 'left' });
      return;
    }

    setFailed(true);
    setSessionMessage(mapped.message);
  }, [onSessionEnd]);

  const handleError = useCallback((error) => {
    setFailed(true);
    setSessionMessage(
      error?.message
        ? 'Could not connect to the media room. Check your network and try again.'
        : 'Could not connect to the media room. Try joining again.',
    );
  }, []);

  const handleLeave = useCallback(() => {
    intentionalLeaveRef.current = true;
    setConnect(false);
    onSessionEnd?.({ kind: 'left' });
  }, [onSessionEnd]);

  const handleRetry = useCallback(() => {
    setFailed(false);
    setSessionMessage('');
    setConnect(false);
    // Remount connection on next tick
    requestAnimationFrame(() => setConnect(true));
  }, []);

  useEffect(() => {
    if (!token || !serverUrl) return undefined;
    return undefined;
  }, [token, serverUrl]);

  if (!token || !serverUrl) {
    return (
      <p className="error" role="alert">
        Media session is missing a LiveKit token or server URL.
      </p>
    );
  }

  if (!connect && failed) {
    return (
      <div className="media-reconnect-panel" role="alert">
        <ConnectionStatus livekitState="disconnected" failed onRetry={handleRetry} />
        {sessionMessage ? <p>{sessionMessage}</p> : null}
      </div>
    );
  }

  return (
    <div className="media-room-shell">
      {sessionMessage && !connect ? (
        <p className="error" role="alert">{sessionMessage}</p>
      ) : null}
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={connect}
        video={Boolean(initialVideo)}
        audio={Boolean(initialAudio)}
        options={options}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
        data-lk-theme="default"
        className="lk-room-container media-lk-room"
      >
        <RoomWorkspace
          admission={admission}
          roomMeta={roomMeta}
          onLeave={handleLeave}
          reconnectCount={reconnectCount}
          connectionFailed={failed}
          onRetryConnect={handleRetry}
        />
      </LiveKitRoom>
    </div>
  );
}

export default MediaRoom;
