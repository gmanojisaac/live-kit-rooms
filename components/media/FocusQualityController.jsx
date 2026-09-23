'use client';

import { useEffect } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track, VideoQuality } from 'livekit-client';
import { buildQualityPlan } from '@/lib/media/quality-policy.js';

/**
 * Apply focus-aware subscription quality (MED-06 / MED-22).
 * Does not recreate the LiveKit room — only adjusts remote publications.
 */
export function FocusQualityController({ focusedId }) {
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });

  useEffect(() => {
    const ids = screens
      .map((t) => t.publication?.trackSid)
      .filter(Boolean);
    const plan = buildQualityPlan(ids, focusedId);

    for (const track of screens) {
      const publication = track.publication;
      if (!publication || track.participant?.isLocal) continue;

      const entry = plan.find((p) => p.trackId === publication.trackSid);
      if (!entry) continue;

      try {
        if (typeof publication.setEnabled === 'function') {
          publication.setEnabled(entry.enabled);
        }
        if (!entry.enabled) continue;

        if (
          typeof publication.setVideoQuality === 'function'
          && entry.videoQuality != null
        ) {
          const q = entry.videoQuality === 2
            ? VideoQuality.HIGH
            : entry.videoQuality === 1
              ? VideoQuality.MEDIUM
              : VideoQuality.LOW;
          publication.setVideoQuality(q);
        }
        if (
          typeof publication.setVideoFPS === 'function'
          && entry.fps > 0
        ) {
          publication.setVideoFPS(entry.fps);
        }
        if (
          typeof publication.setVideoDimensions === 'function'
          && entry.dimensions
        ) {
          publication.setVideoDimensions(entry.dimensions);
        }
      } catch {
        // Degrade gracefully if a browser/API combination rejects overrides.
      }
    }
  }, [screens, focusedId]);

  return null;
}
