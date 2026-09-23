'use client';



import { useCallback, useEffect, useState } from 'react';

import { COORDINATOR_TRANSFER_HANDOFF_EVENT } from '@/lib/rooms/coordinator-transfer-client.js';



function friendlyError(payload, fallback) {

  if (!payload || typeof payload !== 'object') return fallback;

  const code = payload.code;

  switch (code) {

    case 'OWNER_UNAUTHORIZED':

    case 'OWNER_FORBIDDEN':

      return 'You are not authorized as this room’s coordinator.';

    case 'ROOM_ENDED':

      return 'This room has ended.';

    case 'ROOM_EXPIRED':

      return 'This room has expired.';

    case 'PARTICIPANT_NOT_FOUND':

      return 'That participant is no longer in the room.';

    case 'INVITE_NOT_FOUND':

      return 'Invitation not found.';

    case 'TRANSFER_INVALID':

    case 'TRANSFER_EXPIRED':

    case 'TRANSFER_STALE':

      return 'That coordinator transfer is no longer valid.';

    case 'LIVEKIT_UNAVAILABLE':

    case 'LIVEKIT_REMOVE_FAILED':

    case 'LIVEKIT_END_FAILED':

      return 'LiveKit moderation is temporarily unavailable. Try again.';

    default:

      return payload.error || fallback;

  }

}



/**

 * Coordinator moderation panel (AUTH-05 + role transfer).

 * Relies on the HTTP-only owner session cookie — never sends ownerId.

 */

export default function OwnerModerationPanel({ slug, initialRoom }) {

  const [visible, setVisible] = useState(

    Boolean(initialRoom?.isCoordinator ?? initialRoom?.isOwner),

  );

  const [roomStatus, setRoomStatus] = useState(initialRoom?.status || 'active');

  const [locked, setLocked] = useState(Boolean(initialRoom?.promptLocked));

  const [participants, setParticipants] = useState([]);

  const [busy, setBusy] = useState('');

  const [message, setMessage] = useState('');

  const [error, setError] = useState('');

  const [inviteRevoked, setInviteRevoked] = useState(false);



  const inactive = roomStatus === 'ended' || roomStatus === 'expired';



  const refreshParticipants = useCallback(async () => {

    try {

      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/participants`, {

        credentials: 'same-origin',

      });

      if (response.status === 401 || response.status === 403) {

        setVisible(false);

        return;

      }

      if (!response.ok) return;

      const data = await response.json();

      setParticipants(Array.isArray(data.participants) ? data.participants : []);

      if (data.roomStatus) setRoomStatus(data.roomStatus);

    } catch {

      // non-fatal

    }

  }, [slug]);



  const refreshRoom = useCallback(async () => {

    try {

      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}`, {

        credentials: 'same-origin',

      });

      if (!response.ok) return;

      const data = await response.json();

      const isCoordinator = Boolean(

        data.isCoordinator ?? data.isOwner ?? data.room?.isCoordinator ?? data.room?.isOwner,

      );

      setVisible(isCoordinator);

      if (data.room?.status) setRoomStatus(data.room.status);

      if (typeof data.room?.promptLocked === 'boolean') {

        setLocked(data.room.promptLocked);

      }

    } catch {

      // non-fatal

    }

  }, [slug]);



  useEffect(() => {

    refreshRoom();

  }, [refreshRoom]);



  useEffect(() => {

    if (!visible || inactive) return undefined;

    refreshParticipants();

    const timer = setInterval(refreshParticipants, 8000);

    return () => clearInterval(timer);

  }, [visible, inactive, refreshParticipants]);



  async function postAction(path, body, { confirmMessage } = {}) {

    if (confirmMessage && typeof window !== 'undefined') {

      if (!window.confirm(confirmMessage)) return null;

    }

    setBusy(path);

    setError('');

    setMessage('');

    try {

      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}${path}`, {

        method: 'POST',

        credentials: 'same-origin',

        headers: { 'content-type': 'application/json' },

        body: JSON.stringify(body || {}),

      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {

        setError(friendlyError(payload, 'Unable to complete that action.'));

        return null;

      }

      return payload;

    } catch {

      setError('Network error. Check your connection and try again.');

      return null;

    } finally {

      setBusy('');

    }

  }



  async function onToggleLock() {

    const next = !locked;

    const result = await postAction('/lock', { locked: next });

    if (!result) return;

    setLocked(Boolean(result.locked));

    setMessage(next ? 'Prompt editing locked.' : 'Prompt editing unlocked.');

    if (result.roomStatus) setRoomStatus(result.roomStatus);

  }



  async function onRemove(identity, displayName) {

    const label = displayName || identity;

    const result = await postAction('/remove', { participantIdentity: identity }, {

      confirmMessage: `Remove participant ${label}?`,

    });

    if (!result) return;

    setMessage(`Removed ${label}.`);

    setParticipants((prev) => prev.filter((p) => p.identity !== identity));

  }



  async function onMakeCoordinator(identity, displayName) {

    const label = displayName || identity;

    const result = await postAction('/transfer-coordinator', { identity }, {

      confirmMessage:

        `Make ${label} the coordinator? You will lose host controls after they accept.`,

    });

    if (!result) return;



    if (typeof window !== 'undefined') {

      window.dispatchEvent(new CustomEvent(COORDINATOR_TRANSFER_HANDOFF_EVENT, {

        detail: {

          claimToken: result.claimToken,

          expiresAt: result.expiresAt,

          targetIdentity: result.targetIdentity || identity,

          slug,

        },

      }));

    }



    setMessage(`Transfer sent to ${label}. Waiting for them to accept…`);



    // Refresh until we are no longer coordinator (claim completed) or timeout.

    let attempts = 0;

    const poll = async () => {

      attempts += 1;

      await refreshRoom();

      if (attempts < 50) {

        setTimeout(poll, 2500);

      }

    };

    setTimeout(poll, 2000);

  }



  async function onRevokeInvite() {

    const result = await postAction('/revoke-invite', {}, {

      confirmMessage: 'Revoke invitation? New joins with this invite will fail.',

    });

    if (!result) return;

    setInviteRevoked(true);

    setMessage(result.alreadyRevoked

      ? 'Invitation was already revoked.'

      : 'Invitation revoked.');

    if (result.roomStatus) setRoomStatus(result.roomStatus);

  }



  async function onEndRoom() {

    const result = await postAction('/end', {}, {

      confirmMessage: 'End room? Everyone will be disconnected and joins will stop.',

    });

    if (!result) return;

    setRoomStatus('ended');

    setLocked(true);

    setParticipants([]);

    setInviteRevoked(true);

    setMessage(result.alreadyEnded

      ? 'Room was already ended.'

      : 'Room ended.');

  }



  if (!visible) return null;



  return (

    <section className="owner-controls" aria-label="Room controls">

      <h2>Room Controls</h2>

      <p className="hint">

        Status:

        {' '}

        <strong>{roomStatus}</strong>

        {inactive ? ' — moderation actions are closed for this room.' : ''}

      </p>



      {error ? <p className="error" role="alert">{error}</p> : null}

      {message ? <p className="hint" role="status">{message}</p> : null}



      <div className="owner-controls-block">

        <h3>Prompt editing</h3>

        <p>

          {locked || inactive ? 'Locked' : 'Unlocked'}

        </p>

        <button

          type="button"

          onClick={onToggleLock}

          disabled={Boolean(busy) || inactive}

        >

          {busy === '/lock'

            ? 'Updating…'

            : (locked ? 'Unlock prompt editing' : 'Lock prompt editing')}

        </button>

      </div>



      <div className="owner-controls-block">

        <h3>Participants</h3>

        {participants.length === 0 ? (

          <p className="hint">No connected participants right now.</p>

        ) : (

          <ul className="owner-participant-list">

            {participants.map((p) => (

              <li key={p.identity}>

                <span>

                  {p.name || 'Participant'}

                  {' '}

                  <code>{p.identity}</code>

                </span>

                <span className="owner-participant-actions">

                  <button

                    type="button"

                    onClick={() => onMakeCoordinator(p.identity, p.name)}

                    disabled={Boolean(busy) || inactive}

                  >

                    {busy === '/transfer-coordinator' ? 'Transferring…' : 'Make coordinator'}

                  </button>

                  <button

                    type="button"

                    onClick={() => onRemove(p.identity, p.name)}

                    disabled={Boolean(busy) || inactive}

                  >

                    {busy === '/remove' ? 'Removing…' : 'Remove'}

                  </button>

                </span>

              </li>

            ))}

          </ul>

        )}

      </div>



      <div className="owner-controls-block">

        <h3>Invitation</h3>

        <button

          type="button"

          onClick={onRevokeInvite}

          disabled={Boolean(busy) || inactive || inviteRevoked}

        >

          {busy === '/revoke-invite'

            ? 'Revoking…'

            : (inviteRevoked ? 'Invitation revoked' : 'Revoke Invitation')}

        </button>

      </div>



      <div className="owner-controls-block">

        <h3>Room</h3>

        <button

          type="button"

          className="danger"

          onClick={onEndRoom}

          disabled={Boolean(busy) || roomStatus === 'ended' || roomStatus === 'expired'}

        >

          {busy === '/end' ? 'Ending…' : 'End Room'}

        </button>

      </div>

    </section>

  );

}

