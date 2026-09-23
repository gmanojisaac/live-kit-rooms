'use client';

import { useMemo } from 'react';
import {
  connectionStateLabel,
  mapConnectionState,
  UI_CONNECTION,
} from '@/lib/media/connection-state.js';

/**
 * Explicit connection status for MED-01 / MED-07.
 */
export function ConnectionStatus({
  livekitState,
  failed = false,
  onRetry,
}) {
  const ui = useMemo(
    () => mapConnectionState(livekitState, { failed }),
    [livekitState, failed],
  );
  const label = connectionStateLabel(ui);
  const showRetry = ui === UI_CONNECTION.FAILED || ui === UI_CONNECTION.DISCONNECTED;

  return (
    <div
      className={`connection-status connection-status--${ui}`}
      role="status"
      aria-live="polite"
      data-connection-state={ui}
    >
      <span className="connection-status__label">{label}</span>
      {showRetry && typeof onRetry === 'function' ? (
        <button type="button" className="connection-status__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
