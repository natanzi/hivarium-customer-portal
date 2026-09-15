import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { installFetchMock, ok, failed, deferred } from './fetch-mock';
import type { SessionAccountStatus } from '../../shared/types';

const session: SessionAccountStatus = {
  auth: 'session',
  user: { membershipId: 'mbr-acme-admin-001', email: 'dev.admin@acme.example', displayName: 'Dev Admin', role: 'customer_admin' },
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  capabilities: { requestTypes: ['renewal'], canCancel: true, canComment: true },
  membershipStatus: 'active',
  signOutUrl: '/cdn-cgi/access/logout',
};

beforeEach(() => installFetchMock({}));

const overviewBody = {
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  relationship: { status: 'active', commercialModel: 'prepaid_tokens', periodEnd: '2026-12-31T00:00:00.000Z', prepaidBalanceTokens: 4250 },
  agentSummary: { active: 2, scheduled: 1 },
  licenseSummary: { activeLicenses: 2, activeDeployments: 2 },
  requests: { outstanding: 1, recent: [] },
  availability: { operator: 'ok', license: 'ok' },
};

describe('session guard', () => {
  it('shows a loading state while the session is being verified', async () => {
    const gate = deferred<SessionAccountStatus>();
    installFetchMock({ '/api/v1/account/status': gate.handler, '/api/v1/overview': ok(overviewBody) });
    render(<App />);
    expect(await screen.findByRole('status', { name: /checking your session/i })).toBeInTheDocument();
    gate.resolve({ status: 200, body: session });
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows first-party sign in when the session cannot be verified', async () => {
    installFetchMock({ '/api/v1/account/status': failed(401, 'unauthorized', 'Sign-in required.') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in to your portal' })).toBeInTheDocument();
  });

  it('submits a normalized email and shows an enumeration-safe result', async () => {
    let requestBody: unknown;
    installFetchMock({
      '/api/v1/account/status': failed(401, 'unauthorized', 'Sign-in required.'),
      '/api/auth/magic-link': async (init) => {
        requestBody = JSON.parse(String(init.body));
        return { status: 202, body: { message: 'ignored server copy' } };
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Work email'), '  Customer@Example.com  ');
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(requestBody).toEqual({ email: 'customer@example.com' });
    expect(await screen.findByText('If an active portal account exists for that email, a sign-in link is on its way.')).toBeInTheDocument();
    expect(screen.getByText(/expires in 10 minutes/i)).toBeInTheDocument();
  });

  it('shows a safe warning for an invalid or expired link', async () => {
    window.history.pushState({}, '', '/login?error=invalid_link');
    installFetchMock({ '/api/v1/account/status': failed(401, 'unauthorized', 'Sign-in required.') });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid, expired, or has already been used/i);
  });

  it('requires customer confirmation before POSTing the fragment token', async () => {
    const token = 'a'.repeat(64);
    let requestBody: unknown;
    window.history.pushState({}, '', `/login/verify#token=${token}`);
    installFetchMock({
      '/api/v1/account/status': failed(401, 'unauthorized', 'Sign-in required.'),
      '/api/auth/verify': async (init) => {
        requestBody = JSON.parse(String(init.body));
        return { status: 400, body: { error: 'invalid_link' } };
      },
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Continue to your portal' })).toBeInTheDocument();
    expect(requestBody).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Continue to portal' }));
    expect(requestBody).toEqual({ token });
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid, expired, or has already been used/i);
  });

  it('redirects to /service-unavailable when authentication cannot run', async () => {
    installFetchMock({
      '/api/v1/account/status': failed(503, 'service_unavailable', 'Authentication is not configured. Please try again later.'),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Temporarily unavailable' })).toBeInTheDocument();
  });

  it('renders the protected shell once the session is ready', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/overview': ok(overviewBody),
    });
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Sign out' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status', { name: /checking your session/i })).not.toBeInTheDocument());
  });

  it('never renders the shell for a disabled demo membership', async () => {
    installFetchMock({ '/api/v1/account/status': failed(403, 'access_disabled', 'Portal access is disabled for this account.') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Portal access is disabled' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('shows a provisioned-required page for authenticated users without membership', async () => {
    installFetchMock({ '/api/v1/account/status': failed(403, 'not_provisioned', 'Your account has not been provisioned.') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your account has not been provisioned' })).toBeInTheDocument();
  });
});
