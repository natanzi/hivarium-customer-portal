import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App';
import { installFetchMock, ok, failed, deferred } from './fetch-mock';
import type { SessionAccountStatus } from '../../shared/types';

const session: SessionAccountStatus = {
  auth: 'session',
  user: { email: 'dev.admin@acme.example', displayName: 'Dev Admin', role: 'customer_admin' },
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  capabilities: { requestTypes: ['renewal'], canCancel: true, canComment: true },
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
    expect(await screen.findByRole('heading', { name: 'Relationship overview' })).toBeInTheDocument();
  });

  it('redirects to /unauthorized when the session cannot be verified', async () => {
    installFetchMock({ '/api/v1/account/status': failed(401, 'unauthorized', 'Sign-in required.') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'Relationship overview' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status', { name: /checking your session/i })).not.toBeInTheDocument());
  });

  it('never renders the shell for an invalid session', async () => {
    installFetchMock({ '/api/v1/account/status': failed(403, 'forbidden', 'No access.') });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });
});