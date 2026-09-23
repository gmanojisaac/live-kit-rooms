/**
 * Screen-share publication state mapping (MED-03 / MED-08).
 */

/**
 * @param {{ isScreenShareEnabled?: boolean, screenShareTrack?: unknown }|null|undefined} local
 * @returns {boolean}
 */
export function isLocalScreenSharing(local) {
  if (!local) return false;
  if (typeof local.isScreenShareEnabled === 'boolean') {
    return local.isScreenShareEnabled;
  }
  return Boolean(local.screenShareTrack);
}

/**
 * Display label for a tile's share state.
 * @param {boolean} isSharing
 */
export function shareStateLabel(isSharing) {
  return isSharing ? 'Sharing screen' : 'Not sharing';
}

/**
 * Empty-grid copy for a six-person room (BUG-005 / MED-04).
 */
export const SIX_PERSON_EMPTY_SHARE_COPY =
  'Click Share screen below. Up to six people can share a screen at the same time.';

/**
 * Persistent local share warning copy (MED-08).
 */
export const LOCAL_SHARE_WARNING =
  'You are currently sharing your screen with everyone in this room. Prefer sharing a window or tab rather than your entire desktop. This room does not record your screen.';

/**
 * Map a list of screen-share track refs to tile view models.
 * @param {Array<{
 *   publication?: { trackSid?: string, isSubscribed?: boolean },
 *   participant?: { identity?: string, name?: string, isLocal?: boolean, isSpeaking?: boolean },
 * }>} tracks
 */
export function mapScreenShareTiles(tracks) {
  if (!Array.isArray(tracks)) return [];

  return tracks
    .filter((t) => t?.publication?.trackSid)
    .map((t) => {
      const id = t.publication.trackSid;
      const displayName = (t.participant?.name || '').trim() || 'Participant';
      return {
        id,
        displayName,
        identity: t.participant?.identity || '',
        isLocal: Boolean(t.participant?.isLocal),
        isSpeaking: Boolean(t.participant?.isSpeaking),
        isSharing: true,
        label: shareStateLabel(true),
      };
    });
}

/**
 * Build up to six participant presence slots for the voice/camera strip.
 * @param {Array<{ identity?: string, name?: string, isLocal?: boolean, isSpeaking?: boolean, isScreenShareEnabled?: boolean }>} participants
 * @param {number} [max=6]
 */
export function mapParticipantPresence(participants, max = 6) {
  if (!Array.isArray(participants)) return [];
  return participants.slice(0, max).map((p) => {
    const displayName = (p.name || '').trim() || 'Participant';
    return {
      identity: p.identity || '',
      displayName,
      isLocal: Boolean(p.isLocal),
      isSpeaking: Boolean(p.isSpeaking),
      isSharing: Boolean(p.isScreenShareEnabled),
      shareLabel: shareStateLabel(Boolean(p.isScreenShareEnabled)),
    };
  });
}
