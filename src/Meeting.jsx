import React, { useEffect, useState } from 'react';
import {
  Chat, ConnectionStateToast, ControlBar, LayoutContextProvider, ParticipantTile,
  RoomAudioRenderer, VideoTrack, useParticipants, useTracks,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Invitation } from './Invitation';
import { PromptWorkspace } from './PromptWorkspace';

export function Meeting({ session }) {
  const participants = useParticipants();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const [focusedId, setFocusedId] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const focusedScreen = screens.find(track => track.publication.trackSid === focusedId);

  useEffect(() => {
    if (focusedId && !focusedScreen) setFocusedId(null);
  }, [focusedId, focusedScreen]);

  function handleDeviceError({ source, error }) {
    const label = source === Track.Source.ScreenShare ? 'Screen sharing' : source === Track.Source.Camera ? 'Camera' : 'Microphone';
    const advice = error.name === 'NotAllowedError'
      ? 'Permission was denied or the picker was cancelled. Try again and allow access.'
      : error.name === 'NotReadableError'
        ? 'Your browser could not capture the selected device or screen. Check your operating system permissions and try again.'
        : error.message;
    setDeviceError(label + ': ' + advice);
  }

  const screenSharingSupported = window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  return (
    <LayoutContextProvider onWidgetChange={state => setShowChat(state.showChat)}>
      <div className="meeting">
        <header className="meeting-header">
          <div><h1>Collaborative Development Room</h1><p role="status">{participants.length} / 6 participants</p></div>
          <Invitation />
        </header>
        {deviceError && <div role="alert" className="device-error">{deviceError}<button onClick={() => setDeviceError('')}>Dismiss</button></div>}
        {!screenSharingSupported && <p role="status" className="device-error">Screen sharing requires a supported desktop browser and HTTPS (or localhost). You can still watch the other participant.</p>}
        <div className={'meeting-content' + (showChat ? ' with-chat' : '')}>
          <main className="meeting-stage">
            <section className="screen-section" aria-label="Shared screens">
              <div className="section-heading">
                <h2>{focusedScreen ? (focusedScreen.participant.name || 'Participant') + '’s screen' : 'Shared screens'}</h2>
                {focusedScreen && <button onClick={() => setFocusedId(null)}>Return to grid</button>}
              </div>
              {screens.length === 0 ? <div className="screen-empty">Click Share screen below. Up to six people can share a screen at the same time.</div> : (
                <div className={'screen-grid' + (focusedScreen ? ' focused' : '')}>
                  {screens.map(track => {
                    const id = track.publication.trackSid;
                    const name = track.participant.name || 'Participant';
                    return <button key={id} type="button" className="screen-tile" hidden={!!focusedScreen && focusedId !== id}
                      aria-label={'Maximize ' + name + "'s screen"} aria-pressed={focusedId === id} onClick={() => setFocusedId(id)}>
                      <VideoTrack trackRef={track} />
                      <span className="screen-label">{name}{track.participant.isLocal ? ' (you)' : ''} · {focusedId === id ? 'Maximized' : 'Click to maximize'}</span>
                    </button>;
                  })}
                </div>
              )}
            </section>
            <PromptWorkspace session={session} />
            <section className="camera-grid" aria-label="Participant cameras">
              {cameras.map(track => <ParticipantTile key={track.participant.identity} trackRef={track} />)}
            </section>
          </main>
          <Chat className="meeting-chat" style={{ display: showChat ? 'grid' : 'none' }} />
        </div>
        <ControlBar controls={{ chat: true }} onDeviceError={handleDeviceError} />
        <RoomAudioRenderer />
        <ConnectionStateToast />
      </div>
    </LayoutContextProvider>
  );
}
