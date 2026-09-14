/**
 * Deterministic in-memory service adapters for tests only.
 *
 * These adapters implement the exact port contracts documented in
 * docs/internal-service-contracts.md against fictional data. They are wired
 * exclusively by the test suites (vitest integration tests and the Playwright
 * E2E stub server). The production Worker never uses them — production fails
 * closed when a real service binding is missing.
 */

import type {
  AccessState,
  ActivityEventDto,
  AgentProduct,
  CommercialState,
  CustomerProfile,
  LedgerState,
  LicenseState,
  UsageSummary,
} from '../../shared/types';
import type { OperatorPort, UpstreamResult } from './operator';
import type { LicensePort } from './license';

export const FIXTURE_CUSTOMER_ID = 'acme-dev-001';

const NOW = '2026-09-01T12:00:00.000Z';

export class MemoryOperatorService implements OperatorPort {
  constructor(
    private readonly opts: {
      customerId?: string;
      failWith?: 'missing' | 'unreachable' | 'not_implemented';
      failEndpoints?: string[];
    } = {},
  ) {}

  private fail(endpoint: string): UpstreamResult<never> {
    if (this.opts.failEndpoints?.includes(endpoint)) {
      return { ok: false, error: { code: 'not_implemented', detail: 'not implemented upstream' } };
    }
    if (this.opts.failWith === 'missing') {
      return { ok: false, error: { code: 'missing_binding', detail: 'missing binding' } };
    }
    if (this.opts.failWith === 'unreachable') {
      return { ok: false, error: { code: 'unreachable', detail: 'unreachable' } };
    }
    if (this.opts.failWith === 'not_implemented') {
      return { ok: false, error: { code: 'not_implemented', detail: 'not implemented upstream' } };
    }
    return { ok: false, error: { code: 'unreachable', detail: 'unreachable' } };
  }

  private maybeFail(endpoint: string): UpstreamResult<never> | null {
    if (this.opts.failEndpoints?.includes(endpoint) || this.opts.failWith) return this.fail(endpoint);
    return null;
  }

  async getCustomerProfile(): Promise<UpstreamResult<CustomerProfile>> {
    const failed = this.maybeFail('profile');
    if (failed) return failed;
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        name: 'Acme Instruments (Dev Fixture)',
        status: 'active',
      },
    };
  }

  async getCommercial(): Promise<UpstreamResult<CommercialState>> {
    const failed = this.maybeFail('commercial');
    if (failed) return failed;
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        asOf: NOW,
        active: [
          {
            id: 'arr-annual-2026',
            model: 'prepaid_tokens',
            status: 'active',
            effectiveDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-12-31T23:59:59.000Z',
            renewalDate: '2026-12-01T00:00:00.000Z',
            seatCapacity: 25,
            agentCapacity: 12,
            prepaidBalanceTokens: 4_250,
            warningThresholdTokens: 1_000,
            contractReference: 'HV-ACME-2026-001',
            deploymentModel: 'cloud',
            bareMetal: false,
            offlineAllowed: false,
          },
        ],
        scheduled: [],
        history: [
          {
            id: 'arr-monthly-2025',
            model: 'monthly_subscription',
            status: 'ended',
            effectiveDate: '2025-06-01T00:00:00.000Z',
            endDate: '2025-12-31T23:59:59.000Z',
            renewalDate: null,
            seatCapacity: 10,
            agentCapacity: 5,
            prepaidBalanceTokens: null,
            warningThresholdTokens: null,
            contractReference: 'HV-ACME-2025-M',
            deploymentModel: 'cloud',
            bareMetal: false,
            offlineAllowed: false,
          },
        ],
      },
    };
  }

  async getAccess(): Promise<UpstreamResult<AccessState>> {
    const failed = this.maybeFail('access');
    if (failed) return failed;
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        asOf: NOW,
        current: [
          {
            grantId: 'grant-scan-001',
            agentProductId: 'agent-scan-001',
            agentName: 'Threat Surface Scanner',
            category: 'security',
            version: '2.4.1',
            status: 'active',
            startsAt: '2026-03-01T00:00:00.000Z',
            endsAt: '2026-12-31T23:59:59.000Z',
            licenseId: 'lic-scan-2026',
            deploymentId: 'dep-prod-001',
          },
          {
            grantId: 'grant-relay-001',
            agentProductId: 'agent-relay-001',
            agentName: 'Signal Relay Agent',
            category: 'infrastructure',
            version: '1.9.0',
            status: 'active',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: null,
            licenseId: null,
            deploymentId: 'dep-prod-002',
          },
        ],
        scheduled: [
          {
            grantId: 'grant-audit-001',
            agentProductId: 'agent-audit-001',
            agentName: 'Audit Trail Agent',
            category: 'compliance',
            version: '3.0.2',
            status: 'scheduled',
            startsAt: '2026-10-01T00:00:00.000Z',
            endsAt: null,
            licenseId: null,
            deploymentId: null,
          },
        ],
        history: [],
      },
    };
  }

  async getLedger(): Promise<UpstreamResult<LedgerState>> {
    const failed = this.maybeFail('ledger');
    if (failed) return failed;
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        balanceTokens: 4_250,
        netTokensConsumed: 750,
        rows: [
          {
            transactionId: 'tx-0007',
            occurredAt: '2026-08-28T09:15:00.000Z',
            kind: 'usage',
            amountTokens: -120,
            runningBalanceTokens: 4_250,
            reference: 'agent-scan-001',
            reason: 'Scan batch 2026-08-28',
            agentProductId: 'agent-scan-001',
            agentName: 'Threat Surface Scanner',
          },
          {
            transactionId: 'tx-0006',
            occurredAt: '2026-08-14T11:00:00.000Z',
            kind: 'usage',
            amountTokens: -80,
            runningBalanceTokens: 4_370,
            reference: 'agent-relay-001',
            reason: 'Relay relay batch',
            agentProductId: 'agent-relay-001',
            agentName: 'Signal Relay Agent',
          },
          {
            transactionId: 'tx-0005',
            occurredAt: '2026-08-01T08:00:00.000Z',
            kind: 'credit_grant',
            amountTokens: 4_500,
            runningBalanceTokens: 4_450,
            reference: 'HV-ACME-2026-001',
            reason: 'Annual prepaid credit',
            agentProductId: null,
            agentName: null,
          },
          {
            transactionId: 'tx-0004',
            occurredAt: '2026-07-20T14:00:00.000Z',
            kind: 'usage',
            amountTokens: -550,
            runningBalanceTokens: -50,
            reference: 'agent-scan-001',
            reason: 'Large scan run',
            agentProductId: 'agent-scan-001',
            agentName: 'Threat Surface Scanner',
          },
          {
            transactionId: 'tx-0003',
            occurredAt: '2026-07-19T10:00:00.000Z',
            kind: 'reversal',
            amountTokens: 550,
            runningBalanceTokens: 500,
            reference: 'tx-0004',
            reason: 'Operator reversal of duplicate charge',
            agentProductId: null,
            agentName: null,
          },
        ],
      },
    };
  }

  async getUsageSummary(): Promise<UpstreamResult<UsageSummary>> {
    const failed = this.maybeFail('usage-summary');
    if (failed) return failed;
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        netTokensConsumed: 750,
        rows: [
          { agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner', tokensConsumed: 670, usageCount: 42 },
          { agentProductId: 'agent-relay-001', agentName: 'Signal Relay Agent', tokensConsumed: 80, usageCount: 12 },
        ],
      },
    };
  }

  async getAgentCatalog(): Promise<UpstreamResult<AgentProduct[]>> {
    const failed = this.maybeFail('catalog');
    if (failed) return failed;
    return {
      ok: true,
      value: [
        { id: 'agent-scan-001', name: 'Threat Surface Scanner', category: 'security', version: '2.4.1', description: 'Continuous external and internal surface mapping.' },
        { id: 'agent-relay-001', name: 'Signal Relay Agent', category: 'infrastructure', version: '1.9.0', description: 'Reliable signal relay for offline environments.' },
        { id: 'agent-audit-001', name: 'Audit Trail Agent', category: 'compliance', version: '3.0.2', description: 'Append-only audit trail collection.' },
      ],
    };
  }

  async getActivity(): Promise<UpstreamResult<ActivityEventDto[]>> {
    const failed = this.maybeFail('activity');
    if (failed) return failed;
    return {
      ok: true,
      value: [
        { id: 'act-001', occurredAt: '2026-08-28T09:15:00.000Z', type: 'ledger.usage', message: 'Token usage recorded for Threat Surface Scanner.', actor: 'Operator Console' },
        { id: 'act-002', occurredAt: '2026-08-01T08:00:00.000Z', type: 'ledger.credit_grant', message: 'Annual prepaid credit applied.', actor: 'Operator Console' },
      ],
    };
  }
}

export class MemoryLicenseService implements LicensePort {
  constructor(
    private readonly opts: { customerId?: string; failWith?: 'missing' | 'unreachable' | 'not_implemented' } = {},
  ) {}

  async getLicenses(): Promise<UpstreamResult<LicenseState>> {
    if (this.opts.failWith === 'missing') {
      return { ok: false, error: { code: 'missing_binding', detail: 'missing binding' } };
    }
    if (this.opts.failWith === 'unreachable') {
      return { ok: false, error: { code: 'unreachable', detail: 'unreachable' } };
    }
    if (this.opts.failWith === 'not_implemented') {
      return { ok: false, error: { code: 'not_implemented', detail: 'not implemented upstream' } };
    }
    return {
      ok: true,
      value: {
        customerId: this.opts.customerId ?? FIXTURE_CUSTOMER_ID,
        licenses: [
          {
            id: 'lic-scan-2026',
            licenseType: 'subscription',
            status: 'active',
            issuedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-12-31T23:59:59.000Z',
            permittedAgentProducts: ['agent-scan-001', 'agent-relay-001'],
            deployments: [
              {
                id: 'dep-prod-001',
                environment: 'production',
                mode: 'online',
                lastValidatedAt: '2026-08-30T06:00:00.000Z',
                heartbeatAt: '2026-08-30T06:00:00.000Z',
                activationCount: 1,
                activationLimit: 3,
              },
            ],
          },
          {
            id: 'lic-bare-2026',
            licenseType: 'bare_metal',
            status: 'active',
            issuedAt: '2026-02-01T00:00:00.000Z',
            expiresAt: '2027-01-31T23:59:59.000Z',
            permittedAgentProducts: ['agent-relay-001'],
            deployments: [
              {
                id: 'dep-bm-001',
                environment: 'bare_metal',
                mode: 'bare_metal',
                lastValidatedAt: '2026-08-29T22:00:00.000Z',
                heartbeatAt: null,
                activationCount: 1,
                activationLimit: 1,
              },
            ],
          },
        ],
      },
    };
  }
}