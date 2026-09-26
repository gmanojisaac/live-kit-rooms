'use client';

import { useState } from 'react';
import Link from 'next/link';
import { saveOwnerJoinHandoff } from '@/lib/rooms/owner-join-handoff.js';

export default function CreateRoomForm() {
  const [title, setTitle] = useState('');
  const [displayName, setDisplayName] = useState('');
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
      const body = {};
      if (title.trim()) {
        body.title = title.trim();
      }
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

      const finalCode = payload.accessCode || payload.room?.slug;
      if (payload.room?.slug) {
        saveOwnerJoinHandoff({
          slug: payload.room.slug,
          displayName: ownerName,
          accessCode: finalCode,
          ownerJoinToken: payload.ownerJoinToken,
        });
      }
      setResult(payload);
      setDisplayName(ownerName);
      setCreatedAccessCode(finalCode);
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
    const code = createdAccessCode || result?.room?.slug;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('Meeting code copied.');
    } catch {
      setCopyStatus('Clipboard unavailable. Copy the code manually.');
    }
  }

  async function copyFullInvitation() {
    if (!result?.invitationUrl) return;
    const code = createdAccessCode || result?.room?.slug;
    const lines = [
      `Meeting: ${result.room?.title || 'Instant Meeting'}`,
      `Invitation Link: ${result.invitationUrl}`,
    ];
    if (code) {
      lines.push(`Meeting Code: ${code}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyStatus('Full invite (link + meeting code) copied.');
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
            <label htmlFor="create-title">Meeting Title (optional)</label>
            <input
              id="create-title"
              name="title"
              placeholder="e.g. Design review & screen collaboration"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              maxLength={120}
              autoComplete="off"
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
            Your display name is kept for this browser tab, so joining as the host signs you in automatically.
          </p>

          <button type="submit" disabled={busy}>
            {busy ? 'Creating meeting…' : 'Create meeting'}
          </button>
        </form>
      )}

      {error && <p role="alert" className="error" style={{ marginTop: '1rem' }}>{error}</p>}

      {result && (
        <div className="create-room-result panel">
          <h2>Here's your meeting link & code</h2>
          <p>
            <strong>{result.room?.title || 'Instant Meeting'}</strong>
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

          <div className="gm-input-field" style={{ marginTop: '0.75rem' }}>
            <label>Meeting Code</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                readOnly
                value={createdAccessCode || result.room?.slug || ''}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em', fontWeight: 600, color: 'var(--gm-blue)' }}
              />
              <button type="button" onClick={copyAccessCode} style={{ whiteSpace: 'nowrap' }}>
                Copy Code
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1.25rem' }}>
            {result.invitationUrl && (
              <Link
                href={result.invitationUrl}
                className="gm-btn-primary"
                style={{ padding: '0.55rem 1.25rem', fontSize: '0.9rem' }}
              >
                Join meeting now
              </Link>
            )}
            <button
              type="button"
              onClick={copyFullInvitation}
              style={{
                padding: '0.55rem 1rem',
                fontSize: '0.9rem',
                background: 'var(--gm-surface-elevated)',
                border: '1px solid var(--gm-border-subtle)',
                borderRadius: '8px',
                color: 'var(--gm-text-main)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              📋 Copy Full Invite (Link + Code)
            </button>
          </div>

          {copyStatus && <p role="status" className="hint" style={{ color: 'var(--gm-green)', fontWeight: 500, marginTop: '0.75rem' }}>{copyStatus}</p>}
          <p className="hint" style={{ marginTop: '0.75rem' }}>
            Share the invitation link or meeting code with your participants. They can join directly using either the link or by entering the code on the home page.
          </p>
        </div>
      )}
    </div>
  );
}
