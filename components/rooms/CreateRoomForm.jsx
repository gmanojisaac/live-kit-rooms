'use client';

import { useState } from 'react';
import Link from 'next/link';
import { saveOwnerJoinHandoff } from '@/lib/rooms/owner-join-handoff.js';

export default function CreateRoomForm() {
  const [title, setTitle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [createdAccessCode, setCreatedAccessCode] = useState('');
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
      setCreatedAccessCode(accessCode);
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
      setCopyStatus('Invitation link copied.');
    } catch {
      setCopyStatus('Clipboard unavailable. Copy the link manually.');
    }
  }

  async function copyAccessCode() {
    if (!createdAccessCode) return;
    try {
      await navigator.clipboard.writeText(createdAccessCode);
      setCopyStatus('Access code copied.');
    } catch {
      setCopyStatus('Clipboard unavailable. Copy the code manually.');
    }
  }

  async function copyFullInvitation() {
    if (!result?.invitationUrl || !createdAccessCode) return;
    const text = `Join my meeting "${result.room?.title || 'Meeting'}":\nLink: ${result.invitationUrl}\nAccess Code: ${createdAccessCode}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Full invitation (link + access code) copied to clipboard!');
    } catch {
      setCopyStatus('Clipboard unavailable. Copy manually.');
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
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (error) setError('');
              }}
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
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
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
              onChange={(e) => {
                setAccessCode(e.target.value);
                if (error) setError('');
              }}
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                readOnly
                value={result.invitationUrl || ''}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={copyInvitation} style={{ whiteSpace: 'nowrap' }}>
                Copy Link
              </button>
            </div>
          </div>

          {createdAccessCode ? (
            <div className="gm-input-field" style={{ marginTop: '0.75rem' }}>
              <label>Access Code</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  readOnly
                  value={createdAccessCode}
                  onFocus={(e) => e.target.select()}
                  style={{ flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                />
                <button type="button" onClick={copyAccessCode} style={{ whiteSpace: 'nowrap' }}>
                  Copy Code
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1.25rem' }}>
            <button type="button" onClick={copyFullInvitation} className="gm-btn-secondary">
              Copy Full Invite (Link + Code)
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

          {copyStatus && <p role="status" className="hint" style={{ color: 'var(--gm-green)', fontWeight: 500 }}>{copyStatus}</p>}
          <p className="hint" style={{ marginTop: '0.75rem' }}>
            Join meeting now signs you in as {displayName || 'the host'} with the access code you just entered. Send the invitation link and the access code to other people. They still enter both when they join.
          </p>
        </div>
      )}
    </div>
  );
}
