'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled app error:', error);
  }, [error]);

  return (
    <main className="gm-landing-main" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#f28b82', marginBottom: '16px' }}>Something went wrong</h2>
        <p style={{ color: '#9aa0a6', marginBottom: '28px', lineHeight: 1.6 }}>
          {error?.message || 'An unexpected error occurred while loading this meeting room.'}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => reset()}
            className="gm-btn gm-btn-primary"
            style={{ cursor: 'pointer' }}
          >
            Try again
          </button>
          <a
            href="/"
            className="gm-btn gm-btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            Home
          </a>
        </div>
      </div>
    </main>
  );
}
