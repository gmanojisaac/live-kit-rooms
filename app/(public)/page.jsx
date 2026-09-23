'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LiveMeetHeader from '@/components/media/LiveMeetHeader.jsx';

export default function PublicHomePage() {
  const [meetingCode, setMeetingCode] = useState('');
  const router = useRouter();

  function handleJoinByCode(e) {
    e.preventDefault();
    const trimmed = meetingCode.trim();
    if (!trimmed) return;
    // Extract slug if user pasted full URL
    let slug = trimmed;
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const url = new URL(trimmed);
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 'room' && segments[1]) {
          slug = segments[1];
        }
      }
    } catch {
      // not a valid URL, treat as raw slug
    }
    router.push(`/room/${encodeURIComponent(slug)}`);
  }

  return (
    <div className="gm-home-container">
      <LiveMeetHeader />

      <main className="gm-home-hero">
        <div className="gm-hero-content">
          <h1>LiveKit Prompt Review Room</h1>
          <p className="gm-hero-desc">
            Premium video meetings and real-time screen collaboration. Connect voice, share up to six simultaneous screens, and collaborate seamlessly in real time.
          </p>

          <div className="gm-hero-actions">
            <Link href="/create" className="gm-btn-primary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              <span>Create a room</span>
            </Link>

            <form onSubmit={handleJoinByCode} className="gm-join-input-group">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--gm-text-muted)">
                <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
              </svg>
              <input
                type="text"
                placeholder="Enter a code or link"
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                aria-label="Enter meeting code or link"
              />
              <button
                type="submit"
                className="gm-btn-join"
                disabled={!meetingCode.trim()}
              >
                Join
              </button>
            </form>
          </div>

          <div className="gm-hero-divider">
            <p className="hint">
              Secure video rooms powered by LiveKit Cloud, Supabase, and WebRTC with up to 6 simultaneous screen shares.
            </p>
          </div>
        </div>

        <div className="gm-hero-card">
          <div className="gm-hero-card-art">
            <svg width="96" height="96" viewBox="0 0 24 24" fill="var(--gm-blue)">
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2H0c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2h-4zM4 5h16v11H4V5zm8 3l-4 4h2.5v3h3v-3H16l-4-4z" />
            </svg>
          </div>
          <h3>Share your screen & collaborate</h3>
          <p>
            Present presentations, coding sessions, or browser windows with high frame rates and click-to-focus capabilities.
          </p>
          <div className="gm-pill-feature">
            <span>●</span> Up to 6 simultaneous screen shares
          </div>
        </div>
      </main>
    </div>
  );
}
