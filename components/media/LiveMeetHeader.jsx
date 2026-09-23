'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LiveMeetLogo } from './LiveMeetIcons.jsx';

export function LiveMeetHeader({ title = 'Meet', showNavLinks = true }) {
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      setTimeStr(`${time} • ${date}`);
    }
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="gm-app-header">
      <Link href="/" className="gm-logo-group">
        <div className="gm-logo-icon">
          <LiveMeetLogo size={36} />
        </div>
        <div className="gm-logo-title">
          <span>Live</span> <strong>Meet</strong>
          <span className="gm-logo-badge">LiveKit</span>
        </div>
      </Link>

      <div className="gm-header-right">
        {timeStr && <span className="gm-clock">{timeStr}</span>}
        {showNavLinks && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link href="/create" style={{ color: 'var(--gm-blue)', fontSize: '0.9rem', fontWeight: '500' }}>
              Create room
            </Link>
          </div>
        )}
        <div className="gm-avatar-btn" title="Account">
          M
        </div>
      </div>
    </header>
  );
}

export default LiveMeetHeader;
