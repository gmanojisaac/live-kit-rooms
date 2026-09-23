'use client';

import { useEffect, useState } from 'react';
import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { sanitizeMediaDiagnostics, logMediaDiagnostics } from '@/lib/media/diagnostics.js';
import { MEDIA_QUALITY_POLICY_SUMMARY } from '@/lib/media/room-options.js';

/**
 * Dev/QA diagnostics panel — secrets never included.
 * Visible when ?mediaDebug=1 or window.__LKR_MEDIA_DEBUG.
 */
export function MediaDiagnostics({ focusedTrackId = null, reconnectCount = 0 }) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const { localParticipant } = useLocalParticipant();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setVisible(params.get('mediaDebug') === '1' || Boolean(window.__LKR_MEDIA_DEBUG));
  }, []);

  useEffect(() => {
    const snapshot = sanitizeMediaDiagnostics({
      connectionState,
      reconnectCount,
      participantCount: participants.length,
      screenShareCount: screens.length,
      networkQuality: localParticipant?.connectionQuality,
      focusedTrackId,
      dynacast: MEDIA_QUALITY_POLICY_SUMMARY.dynacast,
      adaptiveStream: MEDIA_QUALITY_POLICY_SUMMARY.adaptiveStream,
    });
    logMediaDiagnostics(snapshot);
  }, [
    connectionState,
    reconnectCount,
    participants.length,
    screens.length,
    localParticipant?.connectionQuality,
    focusedTrackId,
  ]);

  if (!visible) return null;

  const data = sanitizeMediaDiagnostics({
    connectionState,
    reconnectCount,
    participantCount: participants.length,
    screenShareCount: screens.length,
    networkQuality: localParticipant?.connectionQuality,
    focusedTrackId,
    dynacast: MEDIA_QUALITY_POLICY_SUMMARY.dynacast,
    adaptiveStream: MEDIA_QUALITY_POLICY_SUMMARY.adaptiveStream,
  });

  return (
    <aside className="media-diagnostics" aria-label="Media diagnostics">
      <h3>Media diagnostics</h3>
      <dl>
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
