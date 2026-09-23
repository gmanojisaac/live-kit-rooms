'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MediaRoom } from '@/components/media/MediaRoom.jsx';
import { MicIcon, CameraIcon } from '@/components/media/LiveMeetIcons.jsx';
import {
  clearOwnerJoinHandoff,
  readOwnerJoinHandoff,
} from '@/lib/rooms/owner-join-handoff.js';

const ownerAutoJoinRequests = new Map();

function runOwnerAutoJoin(slug, task) {
  const existing = ownerAutoJoinRequests.get(slug);
  if (existing) return existing;
  const promise = Promise.resolve().then(task);
  ownerAutoJoinRequests.set(slug, promise);
  promise.finally(() => {
    setTimeout(() => {
      if (ownerAutoJoinRequests.get(slug) === promise) {
        ownerAutoJoinRequests.delete(slug);
      }
    }, 2000);
  });
  return promise;
}

async function requestAdmission({ slug, inviteToken, displayName, accessCode }) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inviteToken,
      displayName,
      accessCode,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    payload,
    retryAfter: response.headers.get('Retry-After'),
  };
}

/**
 * Live Meet Pre-Join Lobby ("Green Room") + Media Room Handoff.
 * Allows camera/mic preview test before admission into LiveKit session.
 */
export default function JoinRoomForm({ slug, inviteToken, roomMeta }) {
  const [displayName, setDisplayName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(null);
  const [admission, setAdmission] = useState(null);
  const [endedMessage, setEndedMessage] = useState('');
  const [ownerJoinPhase, setOwnerJoinPhase] = useState('form');
  const [joinMediaPrefs, setJoinMediaPrefs] = useState({ video: false, audio: false });

  // Lobby device preview state
  const [cameraPreviewOn, setCameraPreviewOn] = useState(false);
  const [micPreviewOn, setMicPreviewOn] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Manage camera preview stream in green room
  useEffect(() => {
    if (!cameraPreviewOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    let cancelled = false;
    navigator.mediaDevices?.getUserMedia?.({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        setCameraPreviewOn(false);
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraPreviewOn]);

  // Clean up media tracks when admission granted
  useEffect(() => {
    if (admission && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [admission]);

  function applyAdmission(payload) {
    clearOwnerJoinHandoff();
    setJoinMediaPrefs({ video: cameraPreviewOn, audio: micPreviewOn });
    setCameraPreviewOn(false);
    setMicPreviewOn(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setAdmission({
      token: payload.token,
      livekitUrl: payload.livekitUrl,
      room: payload.room,
      participant: payload.participant,
    });
    setAccessCode('');
  }

  useLayoutEffect(() => {
    if (!inviteToken) return undefined;
    const handoff = readOwnerJoinHandoff(slug);
    if (!handoff) return undefined;

    let cancelled = false;
    setDisplayName(handoff.displayName);
    setAccessCode(handoff.accessCode);
    setOwnerJoinPhase('joining');
    setBusy(true);
    setError('');

    runOwnerAutoJoin(slug, () => requestAdmission({
      slug,
      inviteToken,
      displayName: handoff.displayName,
      accessCode: handoff.accessCode,
    })).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (!result?.ok) {
        setOwnerJoinPhase('form');
        if (result?.retryAfter) setRetryAfter(result.retryAfter);
        setError(result?.payload?.error || 'Unable to join room.');
        return;
      }
      applyAdmission(result.payload);
    }).catch(() => {
      if (cancelled) return;
      setBusy(false);
      setOwnerJoinPhase('form');
      setError('Unable to join room.');
    });

    return () => {
      cancelled = true;
    };
  }, [slug, inviteToken]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setRetryAfter(null);
    setEndedMessage('');

    try {
      const result = await requestAdmission({
        slug,
        inviteToken,
        displayName,
        accessCode,
      });

      if (!result.ok) {
        if (result.retryAfter) setRetryAfter(result.retryAfter);
        setError(result.payload?.error || 'Unable to join room.');
        return;
      }

      applyAdmission(result.payload);
    } catch {
      setError('Unable to join room.');
    } finally {
      setBusy(false);
    }
  }

  function handleSessionEnd(info) {
    setAdmission(null);
    setOwnerJoinPhase('form');
    if (info?.message) {
      setEndedMessage(info.message);
    } else if (info?.kind === 'left') {
      setEndedMessage('You left the meeting.');
    } else if (info?.kind === 'removed') {
      setEndedMessage('You were removed from this room by the owner.');
    } else if (info?.kind === 'ended') {
      setEndedMessage('This meeting has ended.');
    }
  }

  if (!inviteToken) {
    return (
      <div className="gm-create-card" style={{ maxWidth: '480px', margin: '2rem auto' }}>
        <h2>Invitation required</h2>
        <p className="hint" role="status">
          Open an invitation link that includes the invite token to join this meeting room.
        </p>
      </div>
    );
  }

  if (admission) {
    return (
      <MediaRoom
        admission={admission}
        roomMeta={roomMeta}
        onSessionEnd={handleSessionEnd}
        initialVideo={joinMediaPrefs.video}
        initialAudio={joinMediaPrefs.audio}
      />
    );
  }

  if (ownerJoinPhase === 'joining') {
    return (
      <div className="gm-create-card" style={{ maxWidth: '480px', margin: '2rem auto', textAlign: 'center' }}>
        <h2>Joining the meeting…</h2>
        <p className="hint" role="status">
          Signing in as {displayName || 'the host'} with the access code from when this room was created.
        </p>
      </div>
    );
  }

  const initialLetter = displayName.trim() ? displayName.trim()[0].toUpperCase() : 'Y';

  return (
    <div className="join-room-block">
      {endedMessage ? (
        <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'var(--gm-surface-elevated)', borderRadius: '12px' }}>
          <p className="hint" role="status" style={{ margin: 0, color: 'var(--gm-blue)' }}>{endedMessage}</p>
        </div>
      ) : null}

      <div className="gm-lobby-wrapper">
        {/* Left Column: Camera / Mic Preview (Live Meet Green Room) */}
        <div className="gm-lobby-preview-col">
          <div className="gm-lobby-preview-card">
            {cameraPreviewOn ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="gm-lobby-video-preview"
              />
            ) : (
              <div className="gm-lobby-avatar">{initialLetter}</div>
            )}

            <div className="gm-lobby-preview-controls">
              <button
                type="button"
                className={`gm-circle-btn ${!micPreviewOn ? 'off' : ''}`}
                onClick={() => setMicPreviewOn((v) => !v)}
                title={micPreviewOn ? 'Turn off microphone' : 'Turn on microphone'}
              >
                <MicIcon muted={!micPreviewOn} size={22} />
              </button>

              <button
                type="button"
                className={`gm-circle-btn ${!cameraPreviewOn ? 'off' : ''}`}
                onClick={() => setCameraPreviewOn((v) => !v)}
                title={cameraPreviewOn ? 'Turn off camera' : 'Turn on camera'}
              >
                <CameraIcon off={!cameraPreviewOn} size={22} />
              </button>
            </div>
          </div>

          <p className="hint" style={{ fontSize: '0.85rem', textAlign: 'center' }}>
            {cameraPreviewOn ? 'Camera preview active.' : 'Camera is off. Audio and video start off by default upon joining.'}
          </p>
        </div>

        {/* Right Column: Credentials & Join Form */}
        <div className="gm-lobby-credentials-col">
          <div className="gm-lobby-title-block">
            <h1>Ready to join?</h1>
            <div className="gm-lobby-room-badge">
              <span>Meeting:</span>
              <code>{slug}</code>
            </div>
          </div>

          <form onSubmit={onSubmit} className="join-room-form">
            <label>
              Display name
              <input
                name="displayName"
                placeholder="What's your name?"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={40}
                autoComplete="nickname"
              />
            </label>

            <label>
              Access code
              <input
                name="accessCode"
                type="password"
                placeholder="Enter access code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                required
                minLength={12}
                autoComplete="off"
              />
            </label>

            {error ? (
              <p className="error" role="alert">
                {error}
                {retryAfter ? ` Try again in ${retryAfter}s.` : ''}
              </p>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="submit" disabled={busy}>
                {busy ? 'Joining…' : 'Join now'}
              </button>
            </div>
          </form>

          <p className="hint">
            Up to 6 participants can collaborate and share their screens simultaneously.
          </p>
        </div>
      </div>
    </div>
  );
}
