'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Chat,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ConnectionStatus } from './ConnectionStatus.jsx';
import { ScreenShareGrid } from './ScreenShareGrid.jsx';
import { ParticipantPresence } from './ParticipantPresence.jsx';
import { ScreenShareWarning } from './ScreenShareWarning.jsx';
import { NetworkQualityBanner } from './NetworkQualityBanner.jsx';
import { MediaDiagnostics } from './MediaDiagnostics.jsx';
import { FocusQualityController } from './FocusQualityController.jsx';
import { CollaborativePromptEditor } from '@/components/prompt/CollaborativePromptEditor.jsx';
import { PROMPT_META_TOPIC } from '@/lib/prompts/constants.js';
import {
  MicIcon,
  CameraIcon,
  PresentIcon,
  HangupIcon,
  PeopleIcon,
  ChatIcon,
  ActivitiesIcon,
  InfoIcon,
  MoreVertIcon,
  CloseIcon,
  FullscreenIcon,
} from './LiveMeetIcons.jsx';

import { readOwnerJoinHandoff } from '@/lib/rooms/owner-join-handoff.js';

function roleFromMetadata(participant) {
  if (!participant?.metadata || typeof participant.metadata !== 'string') {
    return 'participant';
  }

  try {
    const metadata = JSON.parse(participant.metadata);
    return metadata?.role === 'admin' ? 'admin' : 'participant';
  } catch {
    return 'participant';
  }
}

function participantRole(participant, { localIdentity, localRole } = {}) {
  const metadataRole = roleFromMetadata(participant);
  if (participant?.identity && participant.identity === localIdentity) {
    return localRole === 'admin' || metadataRole === 'admin' ? 'admin' : 'participant';
  }
  return metadataRole;
}

async function postOwnerAction(slug, path, body = {}, moderatorToken = null) {
  const headers = { 'content-type': 'application/json' };
  if (moderatorToken) {
    headers['x-lkr-moderator-token'] = moderatorToken;
  }

  const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

/**
 * In-call workspace inside LiveKitRoom.
 * Bottom control bar + slide-in drawer for People, Chat, Activities, and Details.
 */
export function RoomWorkspace({
  admission,
  roomMeta,
  onLeave,
  reconnectCount: reconnectCountProp = 0,
  connectionFailed = false,
  onRetryConnect,
}) {
  const room = useRoomContext();
  const livekitState = useConnectionState(room);
  const participants = useParticipants();
  const {
    localParticipant,
    isMicrophoneEnabled = false,
    isCameraEnabled = false,
    isScreenShareEnabled = false,
  } = useLocalParticipant();

  const [focusedId, setFocusedId] = useState(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState(null); // 'people' | 'chat' | 'activities' | 'info' | null
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [localReconnects, setLocalReconnects] = useState(0);
  const [timeStr, setTimeStr] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAccessCode, setCopiedAccessCode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [hostBusy, setHostBusy] = useState('');
  const [hostMessage, setHostMessage] = useState('');
  const [hostError, setHostError] = useState('');
  const [promptLocked, setPromptLocked] = useState(Boolean(roomMeta?.promptLocked));
  const [inviteRevoked, setInviteRevoked] = useState(false);
  const [delegatedModeratorToken, setDelegatedModeratorToken] = useState(
    admission?.moderatorToken || null,
  );

  const prevConnRef = useRef(livekitState);
  const focusContainerRef = useRef(null);
  const moreMenuRef = useRef(null);
  const roomSlug = admission?.room?.slug || roomMeta?.slug || '';
  const localIdentity = admission?.participant?.identity || localParticipant?.identity || '';
  const localRole = admission?.participant?.role === 'admin' || roleFromMetadata(localParticipant) === 'admin'
    ? 'admin'
    : 'participant';
  const moderatorToken = admission?.moderatorToken || delegatedModeratorToken;
  const isOwner = Boolean(localRole === 'admin' && moderatorToken);

  useEffect(() => {
    if (admission?.moderatorToken) {
      setDelegatedModeratorToken(admission.moderatorToken);
    }
  }, [admission?.moderatorToken]);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (localRole !== 'admin' || moderatorToken || !roomSlug || !localIdentity || !admission?.token) {
      return undefined;
    }

    let cancelled = false;
    fetch(`/api/rooms/${encodeURIComponent(roomSlug)}/claim-admin`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantIdentity: localIdentity,
        token: admission.token,
      }),
    })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.payload?.moderatorToken) {
          setDelegatedModeratorToken(result.payload.moderatorToken);
          setHostMessage('Admin controls enabled.');
        } else {
          setHostError(result.payload?.error || 'Unable to enable admin controls.');
        }
      })
      .catch(() => {
        if (!cancelled) setHostError('Unable to enable admin controls.');
      });

    return () => {
      cancelled = true;
    };
  }, [admission?.token, localIdentity, localRole, moderatorToken, roomSlug]);

  useEffect(() => {
    const prev = prevConnRef.current;
    const wasReconnecting = prev === 'reconnecting' || prev === 'signalReconnecting';
    if (wasReconnecting && livekitState === 'connected') {
      setLocalReconnects((n) => n + 1);
    }
    prevConnRef.current = livekitState;
  }, [livekitState]);

  useEffect(() => {
    if (!showMoreMenu) return undefined;
    function onPointerDown(event) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setShowMoreMenu(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showMoreMenu]);

  const reconnectCount = reconnectCountProp + localReconnects;

  const handleFocusChange = useCallback((id) => {
    setFocusedId(id);
  }, []);

  const handleDeviceError = useCallback(({ source, error }) => {
    const label = source === Track.Source.ScreenShare
      ? 'Screen sharing'
      : source === Track.Source.Camera
        ? 'Camera'
        : 'Microphone';
    const name = error?.name || '';
    const advice = name === 'NotAllowedError'
      ? 'Permission was denied. Allow access in your browser.'
      : name === 'NotReadableError'
        ? 'Your browser could not capture the device. Check permissions.'
        : (error?.message || 'Something went wrong. Try again.');
    setDeviceError(`${label}: ${advice}`);
  }, []);

  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (err) {
      handleDeviceError({ source: Track.Source.Microphone, error: err });
    }
  }, [localParticipant, isMicrophoneEnabled, handleDeviceError]);

  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      handleDeviceError({ source: Track.Source.Camera, error: err });
    }
  }, [localParticipant, isCameraEnabled, handleDeviceError]);

  const toggleScreenShare = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch (err) {
      handleDeviceError({ source: Track.Source.ScreenShare, error: err });
    }
  }, [localParticipant, isScreenShareEnabled, handleDeviceError]);

  const requestFullscreen = useCallback(() => {
    const el = focusContainerRef.current;
    if (!el?.requestFullscreen) {
      setDeviceError('Fullscreen is not available in this browser.');
      return;
    }
    el.requestFullscreen().catch(() => {
      setDeviceError('Fullscreen permission was denied.');
    });
  }, []);

  const leave = useCallback(async () => {
    try {
      await room?.disconnect();
    } catch {
      // clear session
    }
    onLeave?.();
  }, [room, onLeave]);

  function copyMeetingCode() {
    const nextSlug = admission?.room?.slug || roomMeta?.slug;
    if (!nextSlug) return;
    navigator.clipboard?.writeText?.(nextSlug);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function copyMeetingLink() {
    if (typeof window === 'undefined') return;
    const link = window.location.href;
    navigator.clipboard?.writeText?.(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function copyAccessCode() {
    const handoff = typeof window !== 'undefined' ? readOwnerJoinHandoff(slug) : null;
    const code = handoff?.accessCode;
    if (!code) return;
    navigator.clipboard?.writeText?.(code);
    setCopiedAccessCode(true);
    setTimeout(() => setCopiedAccessCode(false), 2000);
  }

  function copyAllInfo() {
    if (typeof window === 'undefined') return;
    const handoff = readOwnerJoinHandoff(slug);
    const link = window.location.href;
    const parts = [
      `Meeting: ${title}`,
      `Link: ${link}`,
      `Room Code: ${slug}`,
    ];
    if (handoff?.accessCode) {
      parts.push(`Access Code: ${handoff.accessCode}`);
    }
    navigator.clipboard?.writeText?.(parts.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  function toggleTab(tab) {
    setActiveDrawerTab((prev) => (prev === tab ? null : tab));
    setShowMoreMenu(false);
  }

  const displayName = admission?.participant?.displayName || 'Participant';
  const title = roomMeta?.title || admission?.room?.title || 'Meeting';
  const slug = roomSlug;
  const drawerOpen = Boolean(activeDrawerTab);

  async function runHostAction(path, body, { confirmMessage, onSuccess } = {}) {
    if (!isOwner || !slug) return;
    if (confirmMessage && typeof window !== 'undefined' && !window.confirm(confirmMessage)) {
      return;
    }
    setHostBusy(path);
    setHostError('');
    setHostMessage('');
    try {
      const result = await postOwnerAction(slug, path, body, moderatorToken);
      if (!result.ok) {
        setHostError(result.payload?.error || 'Unable to complete that action.');
        return;
      }
      onSuccess?.(result.payload);
    } catch {
      setHostError('Network error. Check your connection and try again.');
    } finally {
      setHostBusy('');
    }
  }

  const drawerTitle = activeDrawerTab === 'people'
    ? `People (${participants.length})`
    : activeDrawerTab === 'chat'
      ? 'In-call messages'
      : activeDrawerTab === 'activities'
        ? 'Shared prompt'
        : activeDrawerTab === 'info'
          ? 'Meeting details'
          : 'Meeting';

  return (
    <div className="media-workspace" data-testid="media-workspace">
      <header className="meeting-header" style={{ display: 'none' }}>
        <div>
          <h1>{title}</h1>
        </div>
        <div className="meeting-header__status">
          <ConnectionStatus
            livekitState={livekitState}
            failed={connectionFailed}
            onRetry={onRetryConnect}
          />
          <button type="button" className="leave-button" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      <ScreenShareWarning />
      <NetworkQualityBanner />

      {deviceError ? (
        <div role="alert" className="device-error">
          <span>{deviceError}</span>
          <button type="button" onClick={() => setDeviceError('')}>Dismiss</button>
        </div>
      ) : null}

      <div className={`meeting-content${drawerOpen ? ' with-chat' : ''}`}>
        <main className="meeting-stage" ref={focusContainerRef}>
          <div className="meeting-stage-topbar">
            <div className="meeting-stage-topbar__left">
              <span className="meeting-stage-title">{title}</span>
              <ConnectionStatus
                livekitState={livekitState}
                failed={connectionFailed}
                onRetry={onRetryConnect}
              />
            </div>
            {isScreenShareEnabled ? (
              <div className="meeting-presenting-chip">
                <span>● You are presenting to everyone</span>
                <button type="button" onClick={toggleScreenShare}>
                  Stop presenting
                </button>
              </div>
            ) : null}
          </div>

          <ScreenShareGrid
            focusedId={focusedId}
            onFocusChange={handleFocusChange}
            onRequestFullscreen={requestFullscreen}
          />
          <FocusQualityController focusedId={focusedId} />
          <ParticipantPresence />
        </main>

        {/* Keep drawer mounted so chat history + prompt Yjs stay alive when closed */}
        <aside
          className={`gm-drawer${drawerOpen ? '' : ' gm-drawer--collapsed'}`}
          aria-label="Meeting side drawer"
          aria-hidden={!drawerOpen}
        >
          <div className="gm-drawer-header">
            <h3>{drawerTitle}</h3>
            <button
              type="button"
              className="gm-drawer-close"
              onClick={() => setActiveDrawerTab(null)}
              aria-label="Close drawer"
            >
              <CloseIcon size={20} />
            </button>
          </div>

          <div className="gm-drawer-content">
            <div
              className="gm-drawer-panel"
              hidden={activeDrawerTab !== 'people'}
              style={{ display: activeDrawerTab === 'people' ? 'flex' : 'none' }}
            >
              <ul className="gm-people-list">
                {participants.map((p) => {
                  const initial = (p.name || 'P')[0]?.toUpperCase() || 'P';
                  const role = participantRole(p, {
                    localIdentity,
                    localRole,
                  });
                  const canRemove = isOwner && !p.isLocal;
                  const canMakeAdmin = isOwner && !p.isLocal && role !== 'admin';
                  return (
                    <li key={p.identity} className="gm-people-item">
                      <div className="gm-people-info">
                        <div className="gm-people-avatar">{initial}</div>
                        <div className="gm-people-name">
                          <span>{(p.name || '').trim() || 'Participant'}</span>
                          {p.isLocal ? <span className="you"> (You)</span> : null}
                          {role === 'admin' ? <span className="gm-people-role">Admin</span> : null}
                        </div>
                      </div>
                      <div className="gm-people-icons">
                        <MicIcon muted={!p.isMicrophoneEnabled} size={18} />
                        {p.isScreenShareEnabled ? <PresentIcon size={16} /> : null}
                        {canMakeAdmin ? (
                          <button
                            type="button"
                            className="gm-people-admin"
                            disabled={Boolean(hostBusy)}
                            onClick={() => runHostAction('/admin', {
                              participantIdentity: p.identity,
                            }, {
                              confirmMessage: `Make ${(p.name || '').trim() || 'this participant'} an admin?`,
                              onSuccess: () => setHostMessage(`${(p.name || '').trim() || 'Participant'} is now an admin.`),
                            })}
                          >
                            {hostBusy === '/admin' ? '…' : 'Make admin'}
                          </button>
                        ) : null}
                        {canRemove ? (
                          <button
                            type="button"
                            className="gm-people-remove"
                            disabled={Boolean(hostBusy)}
                            onClick={() => runHostAction('/remove', {
                              participantIdentity: p.identity,
                            }, {
                              confirmMessage: `Remove ${(p.name || '').trim() || 'this participant'}?`,
                              onSuccess: () => setHostMessage(`Removed ${(p.name || '').trim() || 'participant'}.`),
                            })}
                          >
                            {hostBusy === '/remove' ? '…' : 'Remove'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {isOwner && (hostError || hostMessage) ? (
                <p className={hostError ? 'error' : 'hint'} role={hostError ? 'alert' : 'status'} style={{ padding: '0 1rem' }}>
                  {hostError || hostMessage}
                </p>
              ) : null}
            </div>

            <div
              className="gm-drawer-panel meeting-chat"
              hidden={activeDrawerTab !== 'chat'}
              style={{ display: activeDrawerTab === 'chat' ? 'flex' : 'none' }}
            >
              <p className="hint meeting-chat-hint">
                Messages can be seen only by people in the call and are deleted when the call ends.
              </p>
              <Chat className="meeting-chat-lk" />
            </div>

            <div
              className="gm-drawer-panel gm-drawer-panel--prompt"
              hidden={activeDrawerTab !== 'activities'}
              style={{ display: activeDrawerTab === 'activities' ? 'flex' : 'none' }}
            >
              <CollaborativePromptEditor
                slug={slug}
                displayName={displayName}
                participantIdentity={admission?.participant?.identity || ''}
                readOnlyHint={promptLocked}
              />
            </div>

            <div
              className="gm-drawer-panel"
              hidden={activeDrawerTab !== 'info'}
              style={{ display: activeDrawerTab === 'info' ? 'block' : 'none' }}
            >
              <div className="gm-info-block">
                <h4>Joining info</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--gm-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                      Meeting Link
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        readOnly
                        value={typeof window !== 'undefined' ? window.location.href : ''}
                        onFocus={(e) => e.target.select()}
                        style={{
                          flex: 1,
                          fontSize: '0.8rem',
                          padding: '0.4rem 0.6rem',
                          background: 'var(--gm-surface-card)',
                          border: '1px solid var(--gm-border-subtle)',
                          borderRadius: '6px',
                          color: 'var(--gm-text-main)',
                        }}
                      />
                      <button
                        type="button"
                        onClick={copyMeetingLink}
                        className="gm-btn-primary"
                        style={{ whiteSpace: 'nowrap', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      >
                        {copiedLink ? 'Link copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--gm-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                      Room Code
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        readOnly
                        value={slug}
                        onFocus={(e) => e.target.select()}
                        style={{
                          flex: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          padding: '0.4rem 0.6rem',
                          background: 'var(--gm-surface-card)',
                          border: '1px solid var(--gm-border-subtle)',
                          borderRadius: '6px',
                          color: 'var(--gm-text-main)',
                        }}
                      />
                      <button
                        type="button"
                        onClick={copyMeetingCode}
                        className="gm-btn-primary"
                        style={{ whiteSpace: 'nowrap', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      >
                        {copiedCode ? 'Code copied!' : 'Copy Code'}
                      </button>
                    </div>
                  </div>

                  {typeof window !== 'undefined' && readOwnerJoinHandoff(slug)?.accessCode ? (
                    <div>
                      <label style={{ fontSize: '0.8rem', color: 'var(--gm-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        Host Access Code
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          readOnly
                          value={readOwnerJoinHandoff(slug).accessCode}
                          onFocus={(e) => e.target.select()}
                          style={{
                            flex: 1,
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            padding: '0.4rem 0.6rem',
                            background: 'var(--gm-surface-card)',
                            border: '1px solid var(--gm-border-subtle)',
                            borderRadius: '6px',
                            color: 'var(--gm-blue)',
                          }}
                        />
                        <button
                          type="button"
                          onClick={copyAccessCode}
                          className="gm-btn-primary"
                          style={{ whiteSpace: 'nowrap', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        >
                          {copiedAccessCode ? 'Code copied!' : 'Copy Code'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={copyAllInfo}
                    style={{
                      marginTop: '0.25rem',
                      padding: '0.5rem',
                      background: 'var(--gm-surface-elevated)',
                      border: '1px solid var(--gm-border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--gm-text-main)',
                      fontSize: '0.825rem',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {copiedAll ? '✓ All Joining Info Copied!' : '📋 Copy Full Info (Link + Code)'}
                  </button>
                </div>
                <p className="hint gm-info-note" style={{ marginTop: '0.75rem' }}>
                  Share the link or room code with participants so they can join.
                </p>
              </div>

              {isOwner ? (
                <div className="gm-info-block gm-host-controls" aria-label="Host controls">
                  <h4>Host controls</h4>
                  {hostError ? <p className="error" role="alert">{hostError}</p> : null}
                  {hostMessage ? <p className="hint" role="status">{hostMessage}</p> : null}

                  <button
                    type="button"
                    className="gm-host-btn"
                    disabled={Boolean(hostBusy)}
                    onClick={() => runHostAction('/lock', { locked: !promptLocked }, {
                      onSuccess: (payload) => {
                        const next = Boolean(payload.locked);
                        setPromptLocked(next);
                        setHostMessage(next ? 'Prompt editing locked.' : 'Prompt editing unlocked.');
                        if (room?.localParticipant?.publishData) {
                          const bytes = new TextEncoder().encode(JSON.stringify({
                            locked: next,
                            roomStatus: payload.roomStatus || 'active',
                          }));
                          room.localParticipant.publishData(bytes, {
                            reliable: true,
                            topic: PROMPT_META_TOPIC,
                          }).catch(() => {});
                        }
                      },
                    })}
                  >
                    {hostBusy === '/lock'
                      ? 'Updating…'
                      : (promptLocked ? 'Unlock prompt editing' : 'Lock prompt editing')}
                  </button>

                  <button
                    type="button"
                    className="gm-host-btn"
                    disabled={Boolean(hostBusy) || inviteRevoked}
                    onClick={() => runHostAction('/revoke-invite', {}, {
                      confirmMessage: 'Revoke invitation? New joins with this invite will fail.',
                      onSuccess: (payload) => {
                        setInviteRevoked(true);
                        setHostMessage(payload.alreadyRevoked
                          ? 'Invitation was already revoked.'
                          : 'Invitation revoked.');
                      },
                    })}
                  >
                    {hostBusy === '/revoke-invite'
                      ? 'Revoking…'
                      : (inviteRevoked ? 'Invitation revoked' : 'Revoke invitation')}
                  </button>

                  <button
                    type="button"
                    className="gm-host-btn gm-host-btn--danger"
                    disabled={Boolean(hostBusy)}
                    onClick={() => runHostAction('/end', {}, {
                      confirmMessage: 'End room? Everyone will be disconnected and joins will stop.',
                      onSuccess: (payload) => {
                        setPromptLocked(true);
                        setInviteRevoked(true);
                        setHostMessage(payload.alreadyEnded
                          ? 'Room was already ended.'
                          : 'Room ended.');
                      },
                    })}
                  >
                    {hostBusy === '/end' ? 'Ending…' : 'End room for everyone'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      <footer className="gm-bottom-bar" aria-label="Meeting controls">
        <div className="gm-bottom-left">
          {timeStr ? <span className="gm-bottom-time">{timeStr}</span> : null}
          <span className="gm-bottom-divider">|</span>
          <div
            className="gm-bottom-code"
            onClick={copyMeetingCode}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                copyMeetingCode();
              }
            }}
            role="button"
            tabIndex={0}
            title="Click to copy meeting code"
          >
            <span>{slug}</span>
            {copiedCode ? <span className="gm-copied">Copied</span> : null}
          </div>
        </div>

        <div className="gm-bottom-center">
          <button
            type="button"
            className={`gm-control-btn ${!isMicrophoneEnabled ? 'off' : ''}`}
            onClick={toggleMic}
            title={isMicrophoneEnabled ? 'Turn off microphone' : 'Turn on microphone'}
            aria-label={isMicrophoneEnabled ? 'Turn off microphone' : 'Turn on microphone'}
          >
            <MicIcon muted={!isMicrophoneEnabled} size={22} />
          </button>

          <button
            type="button"
            className={`gm-control-btn ${!isCameraEnabled ? 'off' : ''}`}
            onClick={toggleCamera}
            title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            <CameraIcon off={!isCameraEnabled} size={22} />
          </button>

          <button
            type="button"
            className={`gm-control-btn ${isScreenShareEnabled ? 'active' : ''}`}
            onClick={toggleScreenShare}
            title={isScreenShareEnabled ? 'Stop presenting' : 'Present now'}
            aria-label={isScreenShareEnabled ? 'Stop presenting' : 'Present screen'}
          >
            <PresentIcon presenting={isScreenShareEnabled} size={22} />
          </button>

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              type="button"
              className={`gm-control-btn ${showMoreMenu ? 'active' : ''}`}
              onClick={() => setShowMoreMenu((v) => !v)}
              title="More options"
              aria-label="More options"
              aria-expanded={showMoreMenu}
            >
              <MoreVertIcon size={22} />
            </button>

            {showMoreMenu ? (
              <div className="gm-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    requestFullscreen();
                    setShowMoreMenu(false);
                  }}
                >
                  <FullscreenIcon size={16} /> Fullscreen
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowDiagnostics((v) => !v);
                    setShowMoreMenu(false);
                  }}
                >
                  Diagnostics {showDiagnostics ? '✓' : ''}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => toggleTab('activities')}
                >
                  <ActivitiesIcon size={16} /> Shared prompt
                </button>
                {isOwner ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="gm-more-menu__danger"
                    onClick={() => {
                      setShowMoreMenu(false);
                      toggleTab('info');
                    }}
                  >
                    Host controls
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="gm-leave-btn"
            onClick={leave}
            title="Leave call"
            aria-label="Leave call"
          >
            <HangupIcon size={24} />
          </button>
        </div>

        <div className="gm-bottom-right">
          <button
            type="button"
            className={`gm-tab-btn ${activeDrawerTab === 'info' ? 'open' : ''}`}
            onClick={() => toggleTab('info')}
            title="Meeting details"
            aria-label="Meeting details"
          >
            <InfoIcon size={22} />
          </button>

          <button
            type="button"
            className={`gm-tab-btn ${activeDrawerTab === 'people' ? 'open' : ''}`}
            onClick={() => toggleTab('people')}
            title={`People (${participants.length})`}
            aria-label="People"
          >
            <PeopleIcon size={22} />
            {participants.length > 0 ? (
              <span className="gm-badge">{participants.length}</span>
            ) : null}
          </button>

          <button
            type="button"
            className={`gm-tab-btn ${activeDrawerTab === 'chat' ? 'open' : ''}`}
            onClick={() => toggleTab('chat')}
            title="In-call messages"
            aria-label="Chat with everyone"
          >
            <ChatIcon size={22} />
          </button>

          <button
            type="button"
            className={`gm-tab-btn ${activeDrawerTab === 'activities' ? 'open' : ''}`}
            onClick={() => toggleTab('activities')}
            title="Shared prompt"
            aria-label="Shared prompt"
          >
            <ActivitiesIcon size={22} />
          </button>
        </div>
      </footer>

      <RoomAudioRenderer />
      {showDiagnostics ? (
        <MediaDiagnostics focusedTrackId={focusedId} reconnectCount={reconnectCount} />
      ) : null}
    </div>
  );
}

export default RoomWorkspace;
