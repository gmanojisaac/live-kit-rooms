'use client';

import { SharedPromptEditor } from './SharedPromptEditor.jsx';

/**
 * Snapshot / read-only prompt view (no LiveKit Yjs transport).
 * Used for ended/expired rooms outside the media session.
 */
export function PromptPlaceholder({ slug, readOnlyHint = false }) {
  return (
    <SharedPromptEditor
      slug={slug}
      readOnlyHint={readOnlyHint}
      displayName="Viewer"
      livekitRoom={null}
    />
  );
}

export default PromptPlaceholder;
