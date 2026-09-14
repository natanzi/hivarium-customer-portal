import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SessionProvider } from '../../src/session';
import RequestNew from '../../src/pages/RequestNew';
import RequestDetail from '../../src/pages/RequestDetail';
import Requests from '../../src/pages/Requests';
import { installFetchMock, ok, created, failed } from './fetch-mock';
import type { SessionAccountStatus } from '../../shared/types';

const session: SessionAccountStatus = {
  auth: 'session',
  user: { membershipId: 'mbr-acme-admin-001', email: 'dev.admin@acme.example', displayName: 'Dev Admin', role: 'customer_admin' },
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  capabilities: { requestTypes: ['renewal', 'capacity_increase', 'prepaid_credit', 'agent_access', 'license_support', 'deployment_support', 'general_support'], canCancel: true, canComment: true },
  signOutUrl: '/cdn-cgi/access/logout',
};

function renderWithSession(ui: React.ReactElement, initialPath = '/requests/new') {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/requests/new" element={ui} />
          <Route path="/requests/:requestId" element={<RequestDetail />} />
          <Route path="/requests" element={<Requests />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

function requestDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-test-001',
    customerId: 'acme-dev-001',
    requestType: 'renewal',
    status: 'submitted',
    title: 'Renewal request',
    reason: 'Please renew.',
    payload: { desiredTerm: 'annual', notes: 'Keep it going.' },
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    cancelledAt: null,
    completedAt: null,
    requestedBy: { membershipId: 'mbr-acme-admin-001', email: 'dev.admin@acme.example', displayName: 'Dev Admin' },
    events: [
      { id: 'evt-1', requestId: 'req-test-001', eventType: 'created', actorType: 'customer', actorReference: 'mbr-acme-admin-001', actorLabel: 'Customer', message: 'Request submitted.', metadata: {}, createdAt: '2026-08-20T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

beforeEach(() => installFetchMock({}));

describe('RequestNew', () => {
  it('validates required fields before submitting', async () => {
    const user = userEvent.setup();
    installFetchMock({ '/api/v1/account/status': ok(session) });
    renderWithSession(<RequestNew />);
    await user.selectOptions(await screen.findByLabelText('Request type'), 'capacity_increase');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This field is required.');
    expect(screen.getByText('This field is required.')).toBeInTheDocument();
  });

  it('submits a request and navigates to its detail page', async () => {
    const user = userEvent.setup();
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests': created({ request: requestDto(), replayed: false }),
      '/api/v1/requests/req-test-001': ok(requestDto()),
    });
    renderWithSession(<RequestNew />);
    await user.selectOptions(await screen.findByLabelText('Request type'), 'renewal');
    await user.selectOptions(screen.getByLabelText('Desired term'), 'annual');
    await user.type(screen.getByLabelText('Notes'), 'Extend for another year.');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('heading', { name: 'Renewal request' })).toBeInTheDocument();
  });

  it('surfaces server validation errors', async () => {
    const user = userEvent.setup();
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests': failed(400, 'validation_error', 'desiredCapacity must be an integer between 1 and 100000.'),
    });
    renderWithSession(<RequestNew />);
    await user.selectOptions(await screen.findByLabelText('Request type'), 'capacity_increase');
    await user.type(await screen.findByLabelText(/Desired capacity/), '50');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/desiredCapacity/);
  });

  it('shows a not-allowed state for read-only roles', async () => {
    installFetchMock({
      '/api/v1/account/status': ok({
        ...session,
        user: { membershipId: 'mbr-acme-readonly-001', email: 'dev.readonly@acme.example', displayName: 'Dev Read-Only', role: 'read_only' },
        capabilities: { requestTypes: [], canCancel: false, canComment: false },
      }),
    });
    renderWithSession(<RequestNew />);
    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit request' })).not.toBeInTheDocument();
  });
});

describe('RequestDetail', () => {
  it('renders details, history and a cancel action for submitted requests', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests/req-test-001': ok(requestDto()),
    });
    renderWithSession(<RequestDetail />, '/requests/req-test-001');
    expect(await screen.findByRole('heading', { name: 'Renewal request' })).toBeInTheDocument();
    expect(screen.getByText('Submitted by')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Request history' })).toBeInTheDocument();
    expect(screen.getByText(/Request submitted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comment')).toBeInTheDocument();
  });

  it('hides the cancel action for non-cancellable states', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests/req-test-001': ok(requestDto({ status: 'approved' })),
    });
    renderWithSession(<RequestDetail />, '/requests/req-test-001');
    expect(await screen.findByRole('heading', { name: 'Renewal request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  it('hides cancel and comment for cancelled requests', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests/req-test-001': ok(
        requestDto({
          status: 'cancelled',
          cancelledAt: '2026-08-21T10:00:00.000Z',
          events: [
            { id: 'evt-1', requestId: 'req-test-001', eventType: 'created', actorType: 'customer', actorReference: 'mbr-acme-admin-001', actorLabel: 'Customer', message: 'Request submitted.', metadata: {}, createdAt: '2026-08-20T10:00:00.000Z' },
            { id: 'evt-2', requestId: 'req-test-001', eventType: 'cancelled', actorType: 'customer', actorReference: 'mbr-acme-admin-001', actorLabel: 'Customer', message: 'Request cancelled by customer.', metadata: {}, createdAt: '2026-08-21T10:00:00.000Z' },
          ],
        }),
      ),
    });
    renderWithSession(<RequestDetail />, '/requests/req-test-001');
    expect(await screen.findByText(/Request cancelled by customer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument();
  });

  it('renders a permission hint when cancellation is not allowed', async () => {
    installFetchMock({
      '/api/v1/account/status': ok({
        ...session,
        user: { membershipId: 'mbr-acme-billing-001', email: 'dev.billing@acme.example', displayName: 'Dev Billing', role: 'billing_viewer' },
        capabilities: { requestTypes: ['renewal', 'capacity_increase'], canCancel: false, canComment: true },
      }),
      '/api/v1/requests/req-test-001': ok(requestDto()),
    });
    renderWithSession(<RequestDetail />, '/requests/req-test-001');
    expect(await screen.findByText(/Only the requester or a customer admin can cancel this request/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });

  it('posts a comment and refreshes history', async () => {
    const user = userEvent.setup();
    let detailCalls = 0;
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests/req-test-001': () => {
        detailCalls += 1;
        const base = requestDto({
          events: [
            { id: 'evt-1', requestId: 'req-test-001', eventType: 'created', actorType: 'customer', actorReference: 'mbr-acme-admin-001', actorLabel: 'Customer', message: 'Request submitted.', metadata: {}, createdAt: '2026-08-20T10:00:00.000Z' },
            ...(detailCalls > 1
              ? [{ id: 'evt-2', requestId: 'req-test-001', eventType: 'comment', actorType: 'customer', actorReference: 'mbr-acme-admin-001', actorLabel: 'Customer', message: 'Any update?', metadata: {}, createdAt: '2026-08-21T10:00:00.000Z' }]
              : []),
          ],
        });
        return { status: 200, body: base };
      },
      '/api/v1/requests/req-test-001/comments': created({ request: requestDto() }),
    });
    renderWithSession(<RequestDetail />, '/requests/req-test-001');
    await user.type(await screen.findByLabelText('Comment'), 'Any update?');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByText('Any update?')).toBeInTheDocument();
  });
});

describe('Requests list', () => {
  it('renders the request list with statuses and pagination', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests?page=1&pageSize=20': ok({
        requests: [
          requestDto(),
          requestDto({ id: 'req-test-002', status: 'approved', title: 'Approved one' }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
        hasMore: false,
      }),
    });
    renderWithSession(<Requests />, '/requests');
    expect(await screen.findByRole('link', { name: /Approved one/ })).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 requests')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no requests', async () => {
    installFetchMock({
      '/api/v1/account/status': ok(session),
      '/api/v1/requests?page=1&pageSize=20': ok({ requests: [], total: 0, page: 1, pageSize: 20, hasMore: false }),
    });
    renderWithSession(<Requests />, '/requests');
    expect(await screen.findByText('No requests match the current filter.')).toBeInTheDocument();
  });
});