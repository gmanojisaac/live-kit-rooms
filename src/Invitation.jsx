import React, { useState } from 'react';

export function Invitation() {
  const [message, setMessage] = useState('');
  const [manualLink, setManualLink] = useState('');
  // The server selects the fixed room. Invitations never contain tokens or credentials.
  const invitationUrl = new URL('/', window.location.origin).href;
  const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  async function copyInvitation() {
    if (localOnly || window.location.protocol !== 'https:') {
      setMessage('To invite another computer, open this app at your private HTTPS address from Tailscale Serve, then copy the invitation link. See README.md for setup.');
      return;
    }
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setManualLink('');
      setMessage('Invitation link copied. Send the existing room access code separately.');
    } catch {
      setManualLink(invitationUrl);
      setMessage('Clipboard access is unavailable. Copy this link manually and send the existing room access code separately.');
    }
  }

  return <div className="invitation">
    <button type="button" onClick={copyInvitation}>Copy Invitation Link</button>
    {message && <p role="status" className="hint">{message}</p>}
    {manualLink && <label>Invitation link<input readOnly value={manualLink} onFocus={event => event.target.select()} /></label>}
  </div>;
}