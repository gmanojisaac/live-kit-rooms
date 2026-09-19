import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import './style.css';

function App() {
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function join(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response = await fetch('/api/join', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, accessCode })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join room');
      setConnection(data);
      setAccessCode('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (!connection) return <main className="welcome"><h1>Collaborative Development Room</h1><p>Join the private trial. Up to six people can meet, talk and share screens.</p><form onSubmit={join}><label>Your name<input value={name} maxLength={40} onChange={e => setName(e.target.value)} required autoComplete="name"/></label><label>Room access code<input type="password" value={accessCode} onChange={e => setAccessCode(e.target.value)} required autoComplete="off"/></label><button disabled={busy}>{busy ? 'Connecting…' : 'Join room'}</button></form>{error && <p role="alert" className="error">{error}</p>}<small>Use HTTPS when sharing the deployed app with other devices so browsers allow camera and microphone access.</small></main>;
  return <div className="room"><LiveKitRoom token={connection.token} serverUrl={connection.serverUrl} connect={true} video={false} audio={false} onDisconnected={() => setConnection(null)} onError={(e) => setError(e.message)} data-lk-theme="default"><VideoConference/><RoomAudioRenderer/></LiveKitRoom>{error && <p role="alert" className="toast">{error}</p>}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
