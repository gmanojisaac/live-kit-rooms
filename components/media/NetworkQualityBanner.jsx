'use client';

import { useEffect, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality, ParticipantEvent } from 'livekit-client';
import {
  isPoorNetworkQuality,
  POOR_NETWORK_MESSAGE,
} from '@/lib/media/connection-state.js';

/**
 * Poor-network message (MED-07) using LiveKit ConnectionQuality.
 */
export function NetworkQualityBanner() {
  const { localParticipant } = useLocalParticipant();
  const [quality, setQuality] = useState(
    localParticipant?.connectionQuality || ConnectionQuality.Unknown,
  );

  useEffect(() => {
    if (!localParticipant) return undefined;

    const sync = () => {
      setQuality(localParticipant.connectionQuality || ConnectionQuality.Unknown);
    };
    sync();

    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, sync);
    return () => {
      localParticipant.off(ParticipantEvent.ConnectionQualityChanged, sync);
    };
  }, [localParticipant]);

  if (!isPoorNetworkQuality(quality)) return null;

  return (
    <div className="network-quality-banner" role="status" aria-live="polite">
      {POOR_NETWORK_MESSAGE}
    </div>
  );
}
