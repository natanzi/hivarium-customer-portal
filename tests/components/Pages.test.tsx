import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Overview from '../../src/pages/Overview';
import Subscription from '../../src/pages/Subscription';
import Agents from '../../src/pages/Agents';
import Licenses from '../../src/pages/Licenses';
import Usage from '../../src/pages/Usage';
import { installFetchMock, ok, failed, deferred } from './fetch-mock';

beforeEach(() => installFetchMock({}));

const commercialPrepaid = {
  customerId: 'acme-dev-001',
  asOf: '2026-09-01T00:00:00.000Z',
  active: [
    {
      id: 'arr-1',
      model: 'prepaid_tokens',
      status: 'active',
      effectiveDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z',
      renewalDate: '2026-12-01T00:00:00.000Z',
      seatCapacity: 25,
      agentCapacity: 12,
      prepaidBalanceTokens: 4250,
      warningThresholdTokens: 1000,
      contractReference: 'HV-ACME-2026-001',
      deploymentModel: 'cloud',
      bareMetal: false,
      offlineAllowed: false,
    },
  ],
  scheduled: [],
  history: [],
};

describe('Overview', () => {
  it('shows a loading state first, then the relationship summary', async () => {
    const overview = deferred<unknown>();
    installFetchMock({ '/api/v1/overview': overview.handler });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    overview.resolve({
      status: 200,
      body: {
        organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
        relationship: { status: 'active', commercialModel: 'prepaid_tokens', effectiveDate: '2026-01-01T00:00:00.000Z', periodEnd: '2026-12-31T00:00:00.000Z', renewalDate: '2026-12-01T00:00:00.000Z', prepaidBalanceTokens: 4250, warningThresholdTokens: 1000, lowBalance: false },
        featureCount: 2,
        agentSummary: { active: 2, scheduled: 1 },
        licenseSummary: { activeLicenses: 2, activeDeployments: 2 },
        requests: { outstanding: 1, recent: [{ id: 'req-1', requestType: 'renewal', status: 'submitted', title: 'Renewal request', createdAt: '2026-08-01T00:00:00.000Z' }] },
        lastSynchronizedAt: '2026-09-01T12:00:00.000Z',
        dataFreshness: 'live',
        availability: { operator: 'ok', license: 'ok' },
      },
    });
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Acme Instruments')).toBeInTheDocument();
    expect(screen.getByText('Prepaid tokens')).toBeInTheDocument();
    expect(screen.getByText('4,250 tokens')).toBeInTheDocument();
    expect(screen.getByText('Renewal request')).toBeInTheDocument();
  });

  it('renders unavailable sections when upstream services are missing', async () => {
    installFetchMock({
      '/api/v1/overview': ok({
        organization: { customerId: 'acme-dev-001', name: null },
        relationship: { status: null, commercialModel: null, effectiveDate: null, periodEnd: null, renewalDate: null, prepaidBalanceTokens: null, warningThresholdTokens: null, lowBalance: false },
        featureCount: null,
        agentSummary: { active: null, scheduled: null },
        licenseSummary: { activeLicenses: null, activeDeployments: null },
        requests: { outstanding: 0, recent: [] },
        lastSynchronizedAt: null,
        dataFreshness: 'unavailable',
        availability: { operator: 'missing', license: 'missing' },
      }),
    });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('Operator Service unavailable')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('License Service unavailable').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a low-balance warning for prepaid accounts at the threshold', async () => {
    installFetchMock({
      '/api/v1/overview': ok({
        organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
        relationship: {
          status: 'active',
          commercialModel: 'prepaid_tokens',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-12-31T00:00:00.000Z',
          renewalDate: null,
          prepaidBalanceTokens: 400,
          warningThresholdTokens: 1000,
          lowBalance: true,
        },
        featureCount: 1,
        agentSummary: { active: 1, scheduled: 0 },
        licenseSummary: { activeLicenses: 1, activeDeployments: 1 },
        requests: { outstanding: 0, recent: [] },
        lastSynchronizedAt: '2026-09-01T12:00:00.000Z',
        dataFreshness: 'live',
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Low prepaid balance/)).toBeInTheDocument();
  });

  it('does not invent a prepaid balance for non-prepaid accounts', async () => {
    installFetchMock({
      '/api/v1/overview': ok({
        organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
        relationship: {
          status: 'active',
          commercialModel: 'annual_contract',
          effectiveDate: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-12-31T00:00:00.000Z',
          renewalDate: '2026-12-01T00:00:00.000Z',
          prepaidBalanceTokens: null,
          warningThresholdTokens: null,
          lowBalance: false,
        },
        featureCount: 2,
        agentSummary: { active: 2, scheduled: 0 },
        licenseSummary: { activeLicenses: 1, activeDeployments: 1 },
        requests: { outstanding: 0, recent: [] },
        lastSynchronizedAt: '2026-09-01T12:00:00.000Z',
        dataFreshness: 'live',
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Not applicable')).toBeInTheDocument();
    expect(screen.queryByText(/Low prepaid balance/)).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the request fails', async () => {
    installFetchMock({
      '/api/v1/overview': failed(500, 'internal_error', 'An unexpected error occurred.'),
    });
    render(
      <MemoryRouter>
        <Overview />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Subscription', () => {
  it('renders prepaid model fields and request actions', async () => {
    installFetchMock({
      '/api/v1/subscription': ok({ commercial: commercialPrepaid, availability: { operator: 'ok', license: 'ok' } }),
    });
    render(
      <MemoryRouter>
        <Subscription />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Prepaid tokens')).toBeInTheDocument();
    expect(screen.getByText('4,250 tokens')).toBeInTheDocument();
    expect(screen.getByText('1,000 tokens')).toBeInTheDocument();
    expect(screen.getByText('HV-ACME-2026-001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request renewal' })).toHaveAttribute('href', '/requests/new?type=renewal');
    expect(screen.getByRole('link', { name: 'Request capacity change' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request prepaid credit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask a billing question' })).toBeInTheDocument();
  });

  it('renders monthly subscription fields and hides prepaid fields', async () => {
    installFetchMock({
      '/api/v1/subscription': ok({
        commercial: {
          customerId: 'acme-dev-001',
          asOf: '2026-09-01T00:00:00.000Z',
          active: [
            {
              id: 'arr-2',
              model: 'monthly_subscription',
              status: 'active',
              effectiveDate: '2026-01-01T00:00:00.000Z',
              endDate: null,
              renewalDate: '2026-10-01T00:00:00.000Z',
              seatCapacity: 10,
              agentCapacity: 4,
              prepaidBalanceTokens: null,
              warningThresholdTokens: null,
              contractReference: null,
              deploymentModel: 'cloud',
              bareMetal: false,
              offlineAllowed: false,
            },
          ],
          scheduled: [],
          history: [],
        },
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Subscription />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Monthly subscription')).toBeInTheDocument();
    expect(screen.getByText('Next renewal')).toBeInTheDocument();
    expect(screen.queryByText('Prepaid balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Warning threshold')).not.toBeInTheDocument();
  });

  it('renders bare-metal constraints for bare-metal agreements', async () => {
    installFetchMock({
      '/api/v1/subscription': ok({
        commercial: {
          customerId: 'acme-dev-001',
          asOf: '2026-09-01T00:00:00.000Z',
          active: [
            {
              id: 'arr-3',
              model: 'bare_metal_agreement',
              status: 'active',
              effectiveDate: '2026-01-01T00:00:00.000Z',
              endDate: '2027-01-31T00:00:00.000Z',
              renewalDate: null,
              seatCapacity: null,
              agentCapacity: 2,
              prepaidBalanceTokens: null,
              warningThresholdTokens: null,
              contractReference: 'HV-BM-2026',
              deploymentModel: null,
              bareMetal: true,
              offlineAllowed: true,
            },
          ],
          scheduled: [],
          history: [],
        },
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Subscription />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bare-metal agreement')).toBeInTheDocument();
    expect(screen.getByText(/Bare-metal \/ offline constraints/)).toBeInTheDocument();
  });

  it('shows an unavailable state when the operator service is missing', async () => {
    installFetchMock({
      '/api/v1/subscription': failed(503, 'service_unavailable', 'This section is temporarily unavailable. Please try again later.'),
    });
    render(
      <MemoryRouter>
        <Subscription />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Agents', () => {
  it('renders agent access cards with dates and license references', async () => {
    installFetchMock({
      '/api/v1/agents': ok({
        access: {
          customerId: 'acme-dev-001',
          asOf: '2026-09-01T00:00:00.000Z',
          current: [
            {
              grantId: 'grant-1',
              agentProductId: 'agent-scan-001',
              agentName: 'Threat Surface Scanner',
              category: 'security',
              version: '2.4.1',
              status: 'active',
              startsAt: '2026-03-01T00:00:00.000Z',
              endsAt: '2026-12-31T23:59:59.000Z',
              licenseId: 'lic-1',
              deploymentId: 'dep-1',
            },
          ],
          scheduled: [],
          history: [],
        },
        catalog: [{ id: 'agent-scan-001', name: 'Threat Surface Scanner', category: 'security', version: '2.4.1', description: 'Maps surfaces.' }],
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Agents />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Threat Surface Scanner' })).toBeInTheDocument();
    expect(screen.getByText('security')).toBeInTheDocument();
    expect(screen.getByText('lic-1')).toBeInTheDocument();
    expect(screen.getByText('dep-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request additional agent access' })).toHaveAttribute(
      'href',
      '/requests/new?type=agent_access',
    );
  });

  it('renders the catalog as available-on-request and never as self-grantable', async () => {
    installFetchMock({
      '/api/v1/agents': ok({
        access: {
          customerId: 'acme-dev-001',
          asOf: '2026-09-01T00:00:00.000Z',
          current: [],
          scheduled: [],
          history: [],
        },
        catalog: [{ id: 'agent-audit-001', name: 'Audit Trail Agent', category: 'compliance', version: '3.0.2', description: 'Audit trails.' }],
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Agents />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Available on request')).toBeInTheDocument();
    expect(screen.getByText('No agents are currently authorized for your organization.')).toBeInTheDocument();
  });
});

describe('Licenses', () => {
  it('renders license and deployment information', async () => {
    installFetchMock({
      '/api/v1/licenses': ok({
        licenses: {
          customerId: 'acme-dev-001',
          licenses: [
            {
              id: 'lic-1',
              licenseType: 'subscription',
              status: 'active',
              issuedAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2026-12-31T23:59:59.000Z',
              permittedAgentProducts: ['agent-scan-001'],
              deployments: [
                { id: 'dep-1', environment: 'production', mode: 'managed-cloud', lastValidatedAt: '2026-08-30T06:00:00.000Z', heartbeatAt: null, activationCount: 1, activationLimit: 3 },
              ],
            },
          ],
        },
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Licenses />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('lic-1')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('dep-1')).toBeInTheDocument();
    expect(screen.getAllByText('Managed cloud').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('renders an unavailable state when the License Service has no endpoint', async () => {
    installFetchMock({
      '/api/v1/licenses': failed(503, 'upstream_unavailable', 'This section is temporarily unavailable. Please try again later.'),
    });
    render(
      <MemoryRouter>
        <Licenses />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows an error when a signed license cannot be downloaded', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    installFetchMock({
      '/api/v1/licenses': ok({
        licenses: {
          customerId: 'acme-dev-001',
          licenses: [
            {
              id: 'lic-1',
              licenseType: 'subscription',
              status: 'active',
              issuedAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2026-12-31T23:59:59.000Z',
              permittedAgentProducts: [],
              deployments: [],
            },
          ],
        },
        availability: { operator: 'ok', license: 'ok' },
      }),
      '/api/v1/licenses/lic-1/document': failed(503, 'upstream_unavailable', 'The signed license document could not be retrieved.'),
    });
    render(
      <MemoryRouter>
        <Licenses />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download signed license' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be retrieved/);
  });
});

describe('Usage', () => {
  it('renders a prepaid ledger that stays distinct from commercial usage', async () => {
    installFetchMock({
      '/api/v1/usage': ok({
        kind: 'prepaid',
        balanceTokens: 4250,
        warningThresholdTokens: 1000,
        ledger: [
          { transactionId: 'tx-1', occurredAt: '2026-08-28T09:15:00.000Z', kind: 'usage', amountTokens: -120, runningBalanceTokens: 4250, reference: 'agent-scan-001', reason: 'Batch', agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner' },
          { transactionId: 'tx-2', occurredAt: '2026-08-01T08:00:00.000Z', kind: 'credit_grant', amountTokens: 4500, runningBalanceTokens: 4370, reference: 'HV-1', reason: 'Annual credit', agentProductId: null, agentName: null },
        ],
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Current balance')).toBeInTheDocument();
    expect(screen.getByText('4,250 tokens')).toBeInTheDocument();
    expect(screen.getByText('Ledger statement')).toBeInTheDocument();
    expect(screen.getAllByText('Credit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Usage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.queryByText('Usage summary')).not.toBeInTheDocument();
  });

  it('renders a commercial usage summary for non-prepaid customers without a token ledger', async () => {
    installFetchMock({
      '/api/v1/usage': ok({
        kind: 'commercial',
        model: 'annual_contract',
        summary: { customerId: 'acme-dev-001', rows: [{ agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner', tokensConsumed: 670, usageCount: 42 }], netTokensConsumed: 670 },
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Usage summary')).toBeInTheDocument();
    expect(screen.getByText('Threat Surface Scanner')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('Ledger statement')).not.toBeInTheDocument();
    expect(screen.queryByText('Current balance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('flags a balance at or below the warning threshold', async () => {
    installFetchMock({
      '/api/v1/usage': ok({
        kind: 'prepaid',
        balanceTokens: 800,
        warningThresholdTokens: 1000,
        ledger: [],
        availability: { operator: 'ok', license: 'ok' },
      }),
    });
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/at or below the warning threshold/i)).toBeInTheDocument();
  });
});

describe('unavailable and unauthorized surfaces', () => {
  it('shows the service-unavailable page content', async () => {
    const { default: ServiceUnavailable } = await import('../../src/pages/ServiceUnavailable');
    render(
      <MemoryRouter>
        <ServiceUnavailable />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Temporarily unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/overview');
  });

  it('shows the unauthorized page with a sign-out link', async () => {
    const { default: Unauthorized } = await import('../../src/pages/Unauthorized');
    render(
      <MemoryRouter>
        <Unauthorized />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Not authorized' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/cdn-cgi/access/logout');
  });
});