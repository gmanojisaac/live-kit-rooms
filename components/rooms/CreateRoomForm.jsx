'use client';

import { useState } from 'react';
import Link from 'next/link';
import { saveOwnerJoinHandoff } from '@/lib/rooms/owner-join-handoff.js';

export default function CreateRoomForm() {
  const [title, setTitle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copyStatus, setCopyStatus] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCopyStatus('');
    setResult(null);

    const ownerName = displayName.trim().replace(/\s+/g, ' ');
    if (!ownerName || ownerName.length > 40) {
      setError('Enter your display name (1–40 characters).');
      setBusy(false);
      return;
    }

    try {
      const body = {
        title,
        accessCode,
      };
      if (expiresAt) {
        body.expiresAt = new Date(expiresAt).toISOString();
      }

      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || 'Unable to create room.');
        return;
      }

      if (payload.room?.slug) {
        saveOwnerJoinHandoff({
          slug: payload.room.slug,
          displayName: ownerName,
          accessCode,
        });
      }
      setResult(payload);
      setDisplayName(ownerName);
      setAccessCode('');
    } catch {
      setError('Unable to create room.');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!result?.invitationUrl) return;
    try {
      await navigator.clipboard.writeText(result.invitationUrl);
      setCopyStatus('Invitation link copied. Send the access code separately.');
    } catch {
      setCopyStatus('Clipboard unavailable. Copy the link manually.');
    }
  }

  return (
    <div className="create-room">
      {!result && (
        <form onSubmit={onSubmit} className="create-room-form">
          <div className="gm-input-field">
            <label htmlFor="create-display-name">Display name</label>
            <input
              id="create-display-name"
              name="displayName"
              placeholder="How you'll appear in the meeting"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={40}
              autoComplete="nickname"
            />
          </div>

          <div className="gm-input-field">
            <label htmlFor="create-title">Meeting Title</label>
            <input
              id="create-title"
              name="title"
              placeholder="e.g. Design review & screen collaboration"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
            />
          </div>

          <div className="gm-input-field">
            <label htmlFor="create-access-code">Access Code</label>
            <input
              id="create-access-code"
              name="accessCode"
              type="password"
              placeholder="Min. 12 characters"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </div>

          <div className="gm-input-field">
            <label htmlFor="create-expires-at">Expiry (optional)</label>
            <input
              id="create-expires-at"
              name="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          <p className="hint">
            Your display name and access code are kept for this browser tab, so joining as the host does not ask for them again. The access code is never placed in the URL. Share the code separately with your team.
          </p>

          <button type="submit" disabled={busy}>
            {busy ? 'Creating meeting…' : 'Create meeting'}
          </button>
        </form>
      )}

      {error && <p role="alert" className="error" style={{ marginTop: '1rem' }}>{error}</p>}

      {result && (
        <div className="create-room-result panel">
          <h2>Here's your meeting link</h2>
          <p>
            <strong>{result.room?.title}</strong>
            {' '}(<code>{result.room?.slug}</code>)
          </p>
          <p className="hint">
            Expires: {result.room?.expiresAt ? new Date(result.room.expiresAt).toLocaleString() : 'Never'}
          </p>

          <div className="gm-input-field">
            <label>Invitation Link</label>
            <input
              readOnly
              value={result.invitationUrl || ''}
              onFocus={(e) => e.target.select()}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={copyInvitation}>
              Copy Invitation Link
            </button>
            {result.invitationUrl && (
              <Link
                href={result.invitationUrl}
                className="gm-btn-primary"
                style={{ padding: '0.55rem 1.25rem', fontSize: '0.9rem' }}
              >
                Join meeting now
              </Link>
            )}
          </div>

          {copyStatus && <p role="status" className="hint" style={{ color: 'var(--gm-green)' }}>{copyStatus}</p>}
          <p className="hint" style={{ marginTop: '0.5rem' }}>
            Join meeting now signs you in as {displayName || 'the host'} with the access code you just entered. Send the invitation link and the access code to other people. They still enter both when they join.
          </p>
        </div>
      )}
    </div>
  );
}
