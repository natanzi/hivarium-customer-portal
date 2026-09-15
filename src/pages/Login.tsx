import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';

const SUCCESS_MESSAGE =
  'If an active portal account exists for that email, a sign-in link is on its way.';

export default function Login() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [validationError, setValidationError] = useState('');
  const invalidLink = searchParams.get('error') === 'invalid_link';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) {
      setValidationError('Enter a valid email address.');
      return;
    }

    setValidationError('');
    setStatus('submitting');
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      setStatus(response.status === 202 ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <header className="login-brand">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>
            <strong>Hivarium</strong>
            <small>Customer portal</small>
          </span>
        </header>

        <div className="login-copy">
          <p className="eyebrow">Secure customer access</p>
          <h1 id="login-title">Sign in to your portal</h1>
          <p>Use the work email address approved for your Hivarium account.</p>
        </div>

        {invalidLink ? (
          <div className="warning-banner" role="alert">
            This sign-in link is invalid, expired, or has already been used. Request a new link below.
          </div>
        ) : null}

        {status === 'sent' ? (
          <div className="login-result" role="status" aria-live="polite">
            <h2>Check your email</h2>
            <p>{SUCCESS_MESSAGE}</p>
            <p className="hint-text">The link expires in 10 minutes. Check your spam or junk folder if you do not see it.</p>
            <button className="btn btn-secondary" type="button" onClick={() => setStatus('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={submit} noValidate>
            <label htmlFor="login-email">Work email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              aria-describedby={validationError ? 'login-email-error' : undefined}
              aria-invalid={validationError ? true : undefined}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === 'submitting'}
              required
            />
            {validationError ? (
              <p id="login-email-error" className="field-error" role="alert">{validationError}</p>
            ) : null}
            {status === 'error' ? (
              <p className="field-error" role="alert">
                We could not start sign-in right now. Please try again.
              </p>
            ) : null}
            <button className="btn btn-primary login-submit" type="submit" disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        <p className="login-footnote">
          No password is required. Sign-in links are single-use and sent by Hivarium.
        </p>
      </section>
    </main>
  );
}
