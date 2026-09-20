import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom } from '@livekit/components-react';
import { Meeting } from './Meeting';
import { Invitation } from './Invitation';
import '@livekit/components-styles';
import './style.css';

function App() {
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const handleError = useCallback(error => setError(error.message || 'Could not connect. Please try joining again.'), []);
  const releaseSeat = useCallback(() => {
    if (!connection?.leaveKey) return;
    fetch('/api/leave', {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ identity: connection.identity, leaveKey: connection.leaveKey }),
    }).catch(() => {}); // The server also expires abandoned reservations.
  }, [connection]);
  const handleDisconnected = useCallback(() => {
    releaseSeat();
    setConnection(null);
  }, [releaseSeat]);

  const handleConnectionError = useCallback(error => {
    handleError(error);
    releaseSeat();
    setConnection(null);
  }, [handleError, releaseSeat]);

  useEffect(() => {
    if (!connection) return;
    const leaveOnClose = () => {
      const body = JSON.stringify({ identity: connection.identity, leaveKey: connection.leaveKey });
      navigator.sendBeacon('/api/leave', new Blob([body], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', leaveOnClose);
    return () => window.removeEventListener('pagehide', leaveOnClose);
  }, [connection]);

  async function join(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/join', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, accessCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join room');
      setConnection(data);
      setAccessCode('');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!connection) return (
    <main className="welcome">
      <h1>Collaborative Development Room</h1>
      <p>A private room for up to six people. Talk, use your cameras, and share screens together.</p>
      <form onSubmit={join}>
        <label>Your name<input value={name} maxLength={40} onChange={e => setName(e.target.value)} required autoComplete="name" /></label>
        <label>Room access code<input type="password" value={accessCode} onChange={e => setAccessCode(e.target.value)} required autoComplete="off" /></label>
        <button disabled={busy}>{busy ? 'Connecting…' : 'Join room'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <Invitation />
      <p className="hint">Everyone uses the same access code. Your camera and microphone start off; enable them after joining.</p>
    </main>
  );

  return (
    <div className="room">
      <LiveKitRoom token={connection.token} serverUrl={connection.serverUrl} connect video={false} audio={false}
        onDisconnected={handleDisconnected} onError={handleConnectionError} data-lk-theme="default">
        <Meeting />
      </LiveKitRoom>
      {error && <div role="alert" className="toast">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);