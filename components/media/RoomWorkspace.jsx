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
import { RoomEvent, Track } from 'livekit-client';
import { ConnectionStatus } from './ConnectionStatus.jsx';
import { ScreenShareGrid } from './ScreenShareGrid.jsx';
import { ParticipantPresence } from './ParticipantPresence.jsx';
import { ScreenShareWarning } from './ScreenShareWarning.jsx';
import { NetworkQualityBanner } from './NetworkQualityBanner.jsx';
import { MediaDiagnostics } from './MediaDiagnostics.jsx';
import { FocusQualityController } from './FocusQualityController.jsx';
import { CollaborativePromptEditor } from '@/components/prompt/CollaborativePromptEditor.jsx';
import {
  COORDINATOR_TRANSFER_DATA_TOPIC,
  COORDINATOR_TRANSFER_HANDOFF_EVENT,
  parseCoordinatorTransferPayload,
  publishCoordinatorTransfer,
} from '@/lib/rooms/coordinator-transfer-client.js';
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

async function postOwnerAction(slug, path, body = {}) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

async function claimCoordinatorRole(slug, claimToken, identity) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/claim-coordinator`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimToken, identity }),
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

  const [isCoordinator, setIsCoordinator] = useState(
    Boolean(roomMeta?.isCoordinator ?? roomMeta?.isOwner),
  );
  const [focusedId, setFocusedId] = useState(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState(null); // 'people' | 'chat' | 'activities' | 'info' | null
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [localReconnects, setLocalReconnects] = useState(0);
  const [timeStr, setTimeStr] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [hostBusy, setHostBusy] = useState('');
  const [hostMessage, setHostMessage] = useState('');
  const [hostError, setHostError] = useState('');
  const [promptLocked, setPromptLocked] = useState(Boolean(roomMeta?.promptLocked));
  const [inviteRevoked, setInviteRevoked] = useState(false);
  const [coordinatorNotice, setCoordinatorNotice] = useState('');

  const prevConnRef = useRef(livekitState);
  const focusContainerRef = useRef(null);
  const moreMenuRef = useRef(null);
  const claimInFlightRef = useRef(false);

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

  function toggleTab(tab) {
    setActiveDrawerTab((prev) => (prev === tab ? null : tab));
    setShowMoreMenu(false);
  }

  const displayName = admission?.participant?.displayName || 'Participant';
  const title = roomMeta?.title || admission?.room?.title || 'Meeting';
  const slug = admission?.room?.slug || roomMeta?.slug || '';
  const localIdentity = admission?.participant?.identity
    || localParticipant?.identity
    || '';
  const drawerOpen = Boolean(activeDrawerTab);

  useEffect(() => {
    setIsCoordinator(Boolean(roomMeta?.isCoordinator ?? roomMeta?.isOwner));
  }, [roomMeta?.isCoordinator, roomMeta?.isOwner]);

  const refreshCoordinatorStatus = useCallback(async () => {
    if (!slug) return;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const data = await response.json();
      const next = Boolean(data.isCoordinator ?? data.isOwner ?? data.room?.isCoordinator ?? data.room?.isOwner);
      setIsCoordinator(next);
      if (typeof data.room?.promptLocked === 'boolean') {
        setPromptLocked(data.room.promptLocked);
      }
    } catch {
      // non-fatal
    }
  }, [slug]);

  const acceptCoordinatorTransfer = useCallback(async (payload) => {
    if (!payload?.claimToken || !payload?.slug) return;
    if (payload.slug !== slug) return;
    if (!localIdentity) return;
    if (claimInFlightRef.current) return;
    claimInFlightRef.current = true;
    try {
      const result = await claimCoordinatorRole(payload.slug, payload.claimToken, localIdentity);
      if (!result.ok) {
        setHostError(result.payload?.error || 'Unable to accept coordinator role.');
        return;
      }
      setIsCoordinator(true);
      setCoordinatorNotice('You are now the coordinator for this meeting.');
      setHostMessage('You are now the coordinator for this meeting.');
      setHostError('');
    } catch {
      setHostError('Unable to accept coordinator role.');
    } finally {
      claimInFlightRef.current = false;
    }
  }, [slug, localIdentity]);

  useEffect(() => {
    if (!room) return undefined;

    const onData = (payload, _participant, _kind, topic) => {
      if (topic && topic !== COORDINATOR_TRANSFER_DATA_TOPIC) return;
      const parsed = parseCoordinatorTransferPayload(payload);
      if (!parsed) return;
      acceptCoordinatorTransfer(parsed);
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, acceptCoordinatorTransfer]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function onHandoff(event) {
      const detail = event?.detail;
      if (!detail?.claimToken || !detail?.targetIdentity || !localParticipant) return;
      if (detail.slug && detail.slug !== slug) return;
      publishCoordinatorTransfer(localParticipant, {
        claimToken: detail.claimToken,
        slug: detail.slug || slug,
        expiresAt: detail.expiresAt || '',
        targetIdentity: detail.targetIdentity,
      }).catch(() => {
        setHostError('Transfer created, but could not notify the participant in-call.');
      });
    }

    window.addEventListener(COORDINATOR_TRANSFER_HANDOFF_EVENT, onHandoff);
    return () => window.removeEventListener(COORDINATOR_TRANSFER_HANDOFF_EVENT, onHandoff);
  }, [localParticipant, slug]);

  async function runHostAction(path, body, { confirmMessage, onSuccess } = {}) {
    if (!isCoordinator || !slug) return;
    if (confirmMessage && typeof window !== 'undefined' && !window.confirm(confirmMessage)) {
      return;
    }
    setHostBusy(path);
    setHostError('');
    setHostMessage('');
    try {
      const result = await postOwnerAction(slug, path, body);
      if (!result.ok) {
        if (result.payload?.code === 'OWNER_UNAUTHORIZED'
          || result.payload?.code === 'OWNER_FORBIDDEN'
          || result.status === 401
          || result.status === 403) {
          setIsCoordinator(false);
        }
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

  async function onMakeCoordinator(identity, displayLabel) {
    if (!isCoordinator || !slug || !localParticipant) return;
    const label = displayLabel || 'this participant';
    if (typeof window !== 'undefined'
      && !window.confirm(
        `Make ${label} the coordinator? You will lose host controls after they accept.`,
      )) {
      return;
    }

    setHostBusy('/transfer-coordinator');
    setHostError('');
    setHostMessage('');
    try {
      const result = await postOwnerAction(slug, '/transfer-coordinator', { identity });
      if (!result.ok) {
        setHostError(result.payload?.error || 'Unable to transfer coordinator role.');
        return;
      }

      await publishCoordinatorTransfer(localParticipant, {
        claimToken: result.payload.claimToken,
        slug,
        expiresAt: result.payload.expiresAt || '',
        targetIdentity: result.payload.targetIdentity || identity,
      });

      setHostMessage(`Transfer sent to ${label}. Waiting for them to accept…`);

      let attempts = 0;
      const maxAttempts = 50;
      const poll = async () => {
        attempts += 1;
        await refreshCoordinatorStatus();
        if (attempts < maxAttempts) {
          setTimeout(poll, 2500);
        }
      };
      setTimeout(poll, 2000);
    } catch {
      setHostError('Unable to transfer coordinator role.');
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
                  const canRemove = isCoordinator && !p.isLocal;
                  const canTransfer = isCoordinator && !p.isLocal;
                  return (
                    <li key={p.identity} className="gm-people-item">
                      <div className="gm-people-info">
                        <div className="gm-people-avatar">{initial}</div>
                        <div className="gm-people-name">
                          <span>{(p.name || '').trim() || 'Participant'}</span>
                          {p.isLocal ? <span className="you"> (You)</span> : null}
                        </div>
                      </div>
                      <div className="gm-people-icons">
                        <MicIcon muted={!p.isMicrophoneEnabled} size={18} />
                        {p.isScreenShareEnabled ? <PresentIcon size={16} /> : null}
                        {canTransfer ? (
                          <button
                            type="button"
                            className="gm-people-remove"
                            disabled={Boolean(hostBusy)}
                            onClick={() => onMakeCoordinator(
                              p.identity,
                              (p.name || '').trim() || 'Participant',
                            )}
                          >
                            {hostBusy === '/transfer-coordinator' ? '…' : 'Make coordinator'}
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
              {(isCoordinator || coordinatorNotice) && (hostError || hostMessage || coordinatorNotice) ? (
                <p className={hostError ? 'error' : 'hint'} role={hostError ? 'alert' : 'status'} style={{ padding: '0 1rem' }}>
                  {hostError || hostMessage || coordinatorNotice}
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
                <p className="hint">
                  Room code: <code>{slug}</code>
                </p>
                <button
                  type="button"
                  onClick={copyMeetingCode}
                  className="gm-btn-primary gm-info-copy"
                >
                  {copiedCode ? 'Code copied!' : 'Copy room code'}
                </button>
                <p className="hint gm-info-note">
                  Access codes are kept separate from links for security.
                </p>
              </div>

              {isCoordinator ? (
                <div className="gm-info-block gm-host-controls" aria-label="Coordinator controls">
                  <h4>Coordinator controls</h4>
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
                {isCoordinator ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="gm-more-menu__danger"
                    onClick={() => {
                      setShowMoreMenu(false);
                      toggleTab('info');
                    }}
                  >
                    Coordinator controls
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
