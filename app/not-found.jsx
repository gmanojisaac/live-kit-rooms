import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="gm-landing-main" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 700, color: '#e8eaed', marginBottom: '16px' }}>404</h1>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 500, color: '#9aa0a6', marginBottom: '24px' }}>Room or page not found</h2>
        <p style={{ color: '#80868b', marginBottom: '32px', lineHeight: 1.6 }}>
          The room link might be expired, invalid, or the page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="gm-btn gm-btn-primary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          Return to Home
        </Link>
      </div>
    </main>
  );
}
