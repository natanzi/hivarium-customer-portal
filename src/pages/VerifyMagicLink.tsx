import { useMemo, useState } from 'react';
import { Link } from 'react-router';

export default function VerifyMagicLink() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', []);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>(token ? 'idle' : 'error');

  async function continueSignIn() {
    if (!token || status === 'submitting') return;
    setStatus('submitting');
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) return setStatus('error');
      window.location.assign('/overview');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="verify-title">
        <header className="login-brand">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span><strong>Hivarium</strong><small>Customer portal</small></span>
        </header>
        <div className="login-copy">
          <p className="eyebrow">Secure customer access</p>
          <h1 id="verify-title">Continue to your portal</h1>
          <p>Confirm below to complete your secure, passwordless sign-in.</p>
        </div>
        {status === 'error' ? <div className="warning-banner" role="alert">This sign-in link is invalid, expired, or has already been used.</div> : null}
        {status !== 'error' ? (
          <button className="btn btn-primary login-submit" type="button" disabled={status === 'submitting'} onClick={() => void continueSignIn()}>
            {status === 'submitting' ? 'Signing in…' : 'Continue to portal'}
          </button>
        ) : null}
        <Link className="btn btn-secondary" to="/login">Request a new sign-in link</Link>
        <p className="login-footnote">This confirmation protects your one-time link from automated email scanners.</p>
      </section>
    </main>
  );
}
