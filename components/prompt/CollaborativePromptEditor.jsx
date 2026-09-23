'use client';

import { useRoomContext } from '@livekit/components-react';
import { SharedPromptEditor } from './SharedPromptEditor.jsx';

/**
 * Collaborative prompt editor bound to the current LiveKit room.
 * Must render inside <LiveKitRoom>.
 */
export function CollaborativePromptEditor({
  slug,
  displayName,
  participantIdentity,
  readOnlyHint = false,
}) {
  const room = useRoomContext();
  return (
    <SharedPromptEditor
      slug={slug}
      displayName={displayName}
      participantIdentity={participantIdentity}
      readOnlyHint={readOnlyHint}
      livekitRoom={room}
    />
  );
}

export default CollaborativePromptEditor;
