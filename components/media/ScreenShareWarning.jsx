'use client';

import { useLocalParticipant } from '@livekit/components-react';
import { LOCAL_SHARE_WARNING } from '@/lib/media/screen-share-state.js';

/**
 * Persistent local screen-share warning (MED-08).
 * Visible while sharing regardless of focused tile.
 */
export function ScreenShareWarning({ onStop }) {
  const { isScreenShareEnabled, localParticipant } = useLocalParticipant();

  if (!isScreenShareEnabled) return null;

  async function stopSharing() {
    try {
      if (typeof onStop === 'function') {
        await onStop();
        return;
      }
      await localParticipant.setScreenShareEnabled(false);
    } catch {
      // Permission / track already ended — warning unmounts when publication clears.
    }
  }

  return (
    <div className="screen-share-warning" role="status" aria-live="polite">
      <p>
        <span aria-hidden="true">⚠ </span>
        {LOCAL_SHARE_WARNING}
      </p>
      <button type="button" onClick={stopSharing}>
        Stop sharing
      </button>
    </div>
  );
}
