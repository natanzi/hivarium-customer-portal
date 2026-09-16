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
      <section className="login-hero">
        <div className="login-hero-content">
          <p className="login-hero-eyebrow"><span className="horizon-line"></span>AI AGENTS FOR TELECOM</p>
          <h1 className="login-hero-title">Customer<br />Portal</h1>
          <p className="login-hero-lede">View your license status,<br />renew contracts, and keep<br />your AI agents working for you.</p>

          <div className="login-hero-cards">
            <div className="hero-feature-card">
              <div className="hero-feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 20V14M12 20V10M18 20V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <span>Manage<br />licenses</span>
              <svg className="hero-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="hero-feature-card">
              <div className="hero-feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 4H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <span>Renew<br />contracts</span>
              <svg className="hero-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </div>

        <div className="login-hero-footer">
          <p className="hero-quote">
            <span className="quote-mark">“</span>
            Powering a more connected<br />world with AI agents.”
          </p>
          <div className="hero-footer-divider">
            <span className="horizon-line"></span><span>REAL AGENTS. REAL IMPACT.</span>
          </div>
          <span className="hero-footer-domain">HIVARIUM.COM</span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <header className="login-panel-header">
          <span className="trusted-eyebrow">TRUSTED BY LEADING TELECOMS<span className="horizon-line"></span></span>
        </header>

        <div className="login-panel-form-container">
          <div className="login-brand-large">
            <div className="brand-logo-hex">
              <svg width="104" height="88" viewBox="0 0 200 170" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 0L125 15V45L100 60L75 45V15L100 0Z" fill="#ffb833" />
                <path d="M150 30L175 45V75L150 90L125 75V45L150 30Z" fill="#ffb833" />
                <path d="M50 30L75 45V75L50 90L25 75V45L50 30Z" fill="#ffb833" />
                <path d="M100 60L125 75V105L100 120L75 105V75L100 60Z" fill="#ffb833" />
                <path d="M150 90L175 105V135L150 150L125 135V105L150 90Z" fill="#ffb833" />
                <path d="M50 90L75 105V135L50 150L25 135V105L50 90Z" fill="#ffb833" />
                <path d="M100 120L125 135V165L100 180L75 165V135L100 120Z" fill="#ffb833" />

                <circle cx="100" cy="30" r="4" fill="#000" />
                <circle cx="150" cy="60" r="4" fill="#000" />
                <circle cx="50" cy="60" r="4" fill="#000" />
                <circle cx="100" cy="90" r="4" fill="#000" />
                <circle cx="150" cy="120" r="4" fill="#000" />
                <circle cx="50" cy="120" r="4" fill="#000" />

                <rect x="94" y="38" width="12" height="4" rx="2" fill="#000" />
                <rect x="144" y="68" width="12" height="4" rx="2" fill="#000" />
                <rect x="44" y="68" width="12" height="4" rx="2" fill="#000" />
                <rect x="94" y="98" width="12" height="4" rx="2" fill="#000" />
                <rect x="144" y="128" width="12" height="4" rx="2" fill="#000" />
                <rect x="44" y="128" width="12" height="4" rx="2" fill="#000" />
              </svg>
            </div>
            <strong>HIVARIUM</strong>
            <small>SWARM AGENTS. REAL IMPACT.</small>
          </div>

          <div className="login-copy">
            <h1 id="login-title">Welcome back</h1>
            <p>Sign in to your Hivarium customer portal.</p>
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
              <div className="input-with-icon">
                <span className="input-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </span>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  aria-describedby={validationError ? 'login-email-error' : undefined}
                  aria-invalid={validationError ? true : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={status === 'submitting'}
                  required
                />
              </div>
              {validationError ? (
                <p id="login-email-error" className="field-error" role="alert">{validationError}</p>
              ) : null}
              {status === 'error' ? (
                <p className="field-error" role="alert">
                  We could not start sign-in right now. Please try again.
                </p>
              ) : null}

              {/* Note: Password field visually simulated per mockup, but magic link logic retained. */}
              <label htmlFor="login-password">Password</label>
              <div className="input-with-icon">
                <span className="input-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </span>
                <input
                  id="login-password"
                  type="password"
                  placeholder="Passwordless magic link"
                  disabled
                />
                <span className="input-icon-right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </span>
              </div>

              <div className="login-form-options">
                <label className="checkbox-label">
                  <input type="checkbox" checked readOnly />
                  <span className="checkbox-custom"></span>
                  Remember me
                </label>
                <span className="forgot-password">No password needed</span>
              </div>

              <button className="btn btn-primary login-submit" type="submit" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Sending…' : 'Sign in'} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </button>
            </form>
          )}

        </div>
        <footer className="login-panel-footer">
          <a href="#support">Contact support</a>
          <span className="footer-separator">|</span>
          <a href="#privacy">Privacy Policy</a>
          <span className="footer-separator">|</span>
          <a href="#terms">Terms of Service</a>
        </footer>
      </section>
    </main>
  );
}
