import { useState } from 'react';

/**
 * POSTs to the first-party logout endpoint. Resolves with the final status so
 * callers (and tests) can inspect the outcome; navigation is the caller's job.
 */
export async function postLogout(): Promise<number> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  return response.status;
}

/**
 * Customer sign-out control.
 *
 * First-party magic-link sessions (`/api/auth/logout`) require a POST to
 * revoke the server-side session, so we render an accessible button that
 * submits the request (credentials included) and then redirects to `/login`.
 *
 * Legacy Cloudflare Access sessions keep their ordinary logout link: the
 * Access edge itself terminates the sign-out at `/cdn-cgi/access/logout`.
 */
export function SignOut({ signOutUrl, className }: { signOutUrl: string; className?: string }) {
  const [submitting, setSubmitting] = useState(false);

  if (signOutUrl !== '/api/auth/logout') {
    return (
      <a className={className} href={signOutUrl}>
        Sign out
      </a>
    );
  }

  async function handleClick() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await postLogout();
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <button
      type="button"
      className={className}
      aria-busy={submitting || undefined}
      disabled={submitting}
      onClick={() => {
        void handleClick();
      }}
    >
      Sign out
    </button>
  );
}
