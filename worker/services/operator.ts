/**
 * OperatorService port.
 *
 * The Operator Console is authoritative for customer records, commercial
 * arrangements, prepaid balances, usage ledgers and agent-access grants. This
 * port is the only way the portal reads that state; the portal never copies
 * authoritative data into its own tables.
 *
 * Every method fails closed with a typed UpstreamError. A missing service
 * binding (or missing local URL override) yields `missing_binding`; an
 * upstream endpoint that does not exist yields `not_implemented`; upstream
 * authentication, 5xx or network failures yield `unreachable`. Callers map
 * these to the documented API error codes and the UI's unavailable states.
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
  AgentAccessGrant,
  LicenseRecord,
} from '../../shared/types';

export interface PortalView {
  organization: { customerId: string; name: string | null; status: string | null };
  commercial: {
    model: string;
    effectiveDate: string;
    endDate: string | null;
    renewalDate: string | null;
  } | null;
  prepaid: { balanceTokens: number | null; warningThresholdTokens: number | null } | null;
  features: string[];
  access: { active: AgentAccessGrant[]; scheduled: AgentAccessGrant[] };
  lastUpdated: string;
}

export type UpstreamErrorCode = 'missing_binding' | 'not_implemented' | 'unreachable';

export interface UpstreamError {
  code: UpstreamErrorCode;
  detail: string;
}

export type UpstreamResult<T> = { ok: true; value: T } | { ok: false; error: UpstreamError };

export interface OperatorPort {
  getCustomerProfile(customerId: string): Promise<UpstreamResult<CustomerProfile>>;
  getCommercial(customerId: string): Promise<UpstreamResult<CommercialState>>;
  getAccess(customerId: string): Promise<UpstreamResult<AccessState>>;
  getLedger(customerId: string): Promise<UpstreamResult<LedgerState>>;
  getUsageSummary(customerId: string): Promise<UpstreamResult<UsageSummary>>;
  getAgentCatalog(): Promise<UpstreamResult<AgentProduct[]>>;
  getActivity(customerId: string): Promise<UpstreamResult<ActivityEventDto[]>>;
  getPortalView(customerId: string): Promise<UpstreamResult<PortalView>>;
}

export interface FetchServiceDeps {
  /** Cloudflare Service Binding (production). */
  binding?: Fetcher;
  /** Local URL override for `wrangler dev` / E2E. Never set in production. */
  urlOverride?: string;
  token?: string;
  /** Optional JSON response validator; returns the typed value or an error. */
  validate?: (value: unknown) => { ok: true; value: unknown } | { ok: false; detail: string };
}

function upstream(code: UpstreamErrorCode, detail: string): UpstreamError {
  return { code, detail };
}

async function fetchServiceJson(deps: FetchServiceDeps, path: string): Promise<unknown> {
  if (!deps.binding && !deps.urlOverride) {
    throw upstream('missing_binding', `Service binding is not configured for ${path}.`);
  }
  try {
    const requestUrl = deps.binding
      ? `https://operator-service${path}`
      : `${deps.urlOverride}${path}`;

    // Add timeouts
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);

    const headers = new Headers();
    if (deps.token) {
      headers.set('Authorization', `Bearer ${deps.token}`);
    }

    const init = {
      headers,
      signal: controller.signal,
    };

    const response = deps.binding
      ? await deps.binding.fetch(requestUrl, init)
      : await fetch(requestUrl, init);

    clearTimeout(id);
    if (response.status === 404) {
      throw upstream('not_implemented', `Upstream endpoint ${path} is not implemented.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw upstream('unreachable', `Upstream endpoint ${path} rejected the portal (${response.status}).`);
    }
    if (!response.ok) {
      throw upstream('unreachable', `Upstream endpoint ${path} failed with ${response.status}.`);
    }
    const body = (await response.json()) as unknown;
    if (deps.validate) {
      const check = deps.validate(body);
      if (!check.ok) throw upstream('unreachable', `Upstream endpoint ${path} returned an unexpected shape: ${check.detail}.`);
      return check.value;
    }
    return body;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw upstream('unreachable', `Upstream endpoint ${path} is unreachable.`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Maps the Operator Console's documented response shapes (see
 * docs/internal-service-contracts.md) onto the portal's typed contract.
 * Unknown or malformed upstream fields become null rather than failing the
 * whole section, but a wholly unexpected body shape is rejected.
 */
export class FetchOperatorService implements OperatorPort {
  constructor(private readonly deps: FetchServiceDeps) { }

  async getCustomerProfile(customerId: string): Promise<UpstreamResult<CustomerProfile>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateCustomerProfile },
        `/api/customers/${encodeURIComponent(customerId)}`,
      );
      return { ok: true, value: body as CustomerProfile };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getCommercial(customerId: string): Promise<UpstreamResult<CommercialState>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateCommercialState },
        `/api/customers/${encodeURIComponent(customerId)}/commercial`,
      );
      return { ok: true, value: body as CommercialState };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getAccess(customerId: string): Promise<UpstreamResult<AccessState>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateAccessState },
        `/api/customers/${encodeURIComponent(customerId)}/access`,
      );
      return { ok: true, value: body as AccessState };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getLedger(customerId: string): Promise<UpstreamResult<LedgerState>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateLedgerState },
        `/api/customers/${encodeURIComponent(customerId)}/ledger`,
      );
      return { ok: true, value: body as LedgerState };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getUsageSummary(customerId: string): Promise<UpstreamResult<UsageSummary>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateUsageSummary },
        `/api/customers/${encodeURIComponent(customerId)}/usage-summary`,
      );
      return { ok: true, value: body as UsageSummary };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getAgentCatalog(): Promise<UpstreamResult<AgentProduct[]>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateAgentCatalog },
        '/api/agents',
      );
      return { ok: true, value: body as AgentProduct[] };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getActivity(customerId: string): Promise<UpstreamResult<ActivityEventDto[]>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validateActivity },
        `/api/customers/${encodeURIComponent(customerId)}/activity`,
      );
      return { ok: true, value: body as ActivityEventDto[] };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  /**
   * Generic typed fetch used by the License port. The expected License
   * Service contract is documented in docs/internal-service-contracts.md.
   */
  async fetchLicenseState(path: string): Promise<UpstreamResult<LicenseState>> {
    try {
      const body = await fetchServiceJson({ ...this.deps, validate: validateLicenseState }, path);
      return { ok: true, value: body as LicenseState };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }

  async getPortalView(customerId: string): Promise<UpstreamResult<PortalView>> {
    try {
      const body = await fetchServiceJson(
        { ...this.deps, validate: validatePortalView },
        `/service/v1/customers/${encodeURIComponent(customerId)}/portal-view`
      );
      return { ok: true, value: body as PortalView };
    } catch (error) {
      return { ok: false, error: toUpstreamError(error) };
    }
  }
}


function toUpstreamError(error: unknown): UpstreamError {
  if (error && typeof error === 'object' && 'code' in error && 'detail' in error) {
    return error as UpstreamError;
  }
  return upstream('unreachable', 'Upstream service is unreachable.');
}

function validateCustomerProfile(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record) return { ok: false, detail: 'not an object' };
  return { ok: true, value: { customerId: asString(record.id) ?? asString(record.customerId) ?? '', name: asString(record.name) ?? null, status: asString(record.status) ?? null } };
}

function validateCommercialState(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record || !asArray(record.active)) return { ok: false, detail: 'missing active arrangements' };
  const arrangements = asArray(record.active)!.map((entry) => {
    const a = asRecord(entry);
    if (!a) return null;
    return {
      id: asString(a.id) ?? '',
      model: (asString(a.model) ?? 'negotiated_agreement') as CommercialState['active'][number]['model'],
      status: asString(a.status) ?? 'unknown',
      effectiveDate: asString(a.effectiveDate) ?? asString(a.startsAt) ?? '',
      endDate: asString(a.endDate) ?? asString(a.endsAt) ?? null,
      renewalDate: asString(a.renewalDate) ?? null,
      seatCapacity: asNumber(a.seatCapacity) ?? asNumber(a.seats) ?? null,
      agentCapacity: asNumber(a.agentCapacity) ?? null,
      prepaidBalanceTokens: asNumber(a.prepaidBalanceTokens) ?? asNumber(a.balanceTokens) ?? null,
      warningThresholdTokens: asNumber(a.warningThresholdTokens) ?? null,
      contractReference: asString(a.contractReference) ?? asString(a.reference) ?? null,
      deploymentModel: asString(a.deploymentModel) ?? null,
      bareMetal: a.bareMetal === true || a.bareMetalModel === true,
      offlineAllowed: a.offlineAllowed === true,
    };
  });
  return {
    ok: true,
    value: {
      customerId: asString(record.customerId) ?? '',
      asOf: asString(record.asOf) ?? new Date().toISOString(),
      active: arrangements.filter(Boolean),
      scheduled: [],
      history: [],
    },
  };
}

function validateAccessState(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record || !asArray(record.current)) return { ok: false, detail: 'missing current grants' };
  const mapGrant = (entry: unknown) => {
    const g = asRecord(entry);
    if (!g) return null;
    return {
      grantId: asString(g.grantId) ?? asString(g.id) ?? '',
      agentProductId: asString(g.agentProductId) ?? '',
      agentName: asString(g.agentName) ?? asString(g.agentProductId) ?? 'Agent',
      category: asString(g.category) ?? null,
      version: asString(g.version) ?? null,
      status: (asString(g.status) ?? 'active') as 'active' | 'scheduled' | 'expired' | 'revoked',
      startsAt: asString(g.startsAt) ?? asString(g.starts_at) ?? '',
      endsAt: asString(g.endsAt) ?? asString(g.ends_at) ?? null,
      licenseId: asString(g.licenseId) ?? null,
      deploymentId: asString(g.deploymentId) ?? null,
    };
  };
  return {
    ok: true,
    value: {
      customerId: asString(record.customerId) ?? '',
      asOf: asString(record.asOf) ?? new Date().toISOString(),
      current: asArray(record.current)!.map(mapGrant).filter(Boolean),
      scheduled: (asArray(record.scheduled) ?? []).map(mapGrant).filter(Boolean),
      history: (asArray(record.history) ?? []).map(mapGrant).filter(Boolean),
    },
  };
}

function validateLedgerState(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record || !asArray(record.rows)) return { ok: false, detail: 'missing ledger rows' };
  let running = 0;
  const rows = asArray(record.rows)!.map((entry) => {
    const row = asRecord(entry);
    if (!row) return null;
    const amount = asNumber(row.amountTokens) ?? asNumber(row.tokens) ?? 0;
    const balance = asNumber(row.runningBalanceTokens);
    if (balance !== null) running = balance;
    else running += amount;
    return {
      transactionId: asString(row.transactionId) ?? asString(row.id) ?? '',
      occurredAt: asString(row.occurredAt) ?? asString(row.occurred_at) ?? '',
      kind: (asString(row.kind) ?? 'usage') as 'credit_grant' | 'usage' | 'adjustment' | 'reversal',
      amountTokens: amount,
      runningBalanceTokens: balance ?? running,
      reference: asString(row.reference) ?? '',
      reason: asString(row.reason) ?? null,
      agentProductId: asString(row.agentProductId) ?? null,
      agentName: asString(row.agentName) ?? null,
    };
  });
  const typedRows = rows.filter(Boolean);
  // Prefer the authoritative top-level balance when the upstream provides it;
  // otherwise use the running balance of the most recent ledger entry.
  const explicitBalance = asNumber(record.balanceTokens);
  const lastRow = typedRows[typedRows.length - 1];
  return {
    ok: true,
    value: {
      customerId: asString(record.customerId) ?? '',
      rows: typedRows,
      balanceTokens: explicitBalance ?? lastRow?.runningBalanceTokens ?? 0,
      netTokensConsumed: asNumber(record.netTokensConsumed) ?? 0,
    },
  };
}

function validateUsageSummary(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record) return { ok: false, detail: 'not an object' };
  const rows = (asArray(record.rows) ?? []).map((entry) => {
    const row = asRecord(entry);
    if (!row) return null;
    return {
      agentProductId: asString(row.agentProductId) ?? '',
      agentName: asString(row.agentName) ?? asString(row.agentProductId) ?? 'Agent',
      tokensConsumed: asNumber(row.tokensConsumed) ?? 0,
      usageCount: asNumber(row.usageCount) ?? 0,
    };
  });
  return {
    ok: true,
    value: {
      customerId: asString(record.customerId) ?? '',
      rows: rows.filter(Boolean),
      netTokensConsumed: asNumber(record.netTokensConsumed) ?? 0,
    },
  };
}

function validateAgentCatalog(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const raw = asArray(value) ?? asArray(asRecord(value)?.products);
  if (!raw) return { ok: false, detail: 'missing products array' };
  const products = raw.map((entry) => {
    const p = asRecord(entry);
    if (!p) return null;
    return {
      id: asString(p.id) ?? '',
      name: asString(p.name) ?? asString(p.id) ?? 'Agent',
      category: asString(p.category) ?? null,
      version: asString(p.version) ?? null,
      description: asString(p.description) ?? null,
    };
  });
  return { ok: true, value: products.filter(Boolean) };
}

function validateActivity(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const raw = asArray(value) ?? asArray(asRecord(value)?.events);
  if (!raw) return { ok: false, detail: 'missing events array' };
  const events = raw.map((entry) => {
    const e = asRecord(entry);
    if (!e) return null;
    return {
      id: asString(e.id) ?? asString(e.type) ?? '',
      occurredAt: asString(e.occurredAt) ?? asString(e.occurred_at) ?? '',
      type: asString(e.type) ?? 'event',
      message: asString(e.message) ?? asString(e.summary) ?? '',
      actor: asString(e.actor) ?? null,
    };
  });
  return { ok: true, value: events.filter(Boolean) };
}

function mapLicenseStatus(value: string | null): LicenseRecord['status'] {
  if (value === 'draft') return 'pending';
  if (value === 'superseded') return 'expired';
  if (value === 'active' || value === 'expired' || value === 'revoked' || value === 'pending' || value === 'suspended') {
    return value;
  }
  return 'active';
}

function mapLicenseRecord(entry: unknown): LicenseRecord | null {
  const l = asRecord(entry);
  if (!l) return null;
  const deployments = (asArray(l.deployments) ?? []).map((dep) => {
    const d = asRecord(dep);
    if (!d) return null;
    const modeRaw = asString(d.mode) ?? asString(d.deploymentType);
    const mode = modeRaw === 'offline' || modeRaw === 'air-gapped' || modeRaw === 'bare_metal'
      ? (modeRaw === 'air-gapped' ? 'offline' : modeRaw)
      : 'online';
    return {
      id: asString(d.id) ?? '',
      environment: asString(d.environment) ?? 'production',
      mode: mode as 'online' | 'offline' | 'bare_metal',
      lastValidatedAt: asString(d.lastValidatedAt) ?? asString(d.last_validated_at) ?? null,
      heartbeatAt: asString(d.heartbeatAt) ?? asString(d.heartbeat_at) ?? null,
      activationCount: asNumber(d.activationCount) ?? 0,
      activationLimit: asNumber(d.activationLimit) ?? null,
    };
  });
  return {
    id: asString(l.id) ?? asString(l.licenseId) ?? '',
    licenseType: asString(l.licenseType) ?? asString(l.type) ?? 'license',
    status: mapLicenseStatus(asString(l.status)),
    issuedAt: asString(l.issuedAt) ?? asString(l.issued_at) ?? asString(l.validFrom) ?? '',
    expiresAt: asString(l.expiresAt) ?? asString(l.expires_at) ?? asString(l.validUntil) ?? '',
    product: asString(l.product) ?? asString(l.productId) ?? asString(l.productName) ?? undefined,
    revision: asString(l.revision) ?? undefined,
    permittedAgentProducts: (asArray(l.permittedAgentProducts) ?? []).map((p) => asString(p)).filter((p): p is string => p !== null),
    deployments: deployments.filter((d): d is NonNullable<typeof d> => d !== null),
  };
}

function validateLicenseState(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  const raw = asArray(record?.licenses) ?? asArray(record?.data);
  if (!raw) return { ok: false, detail: 'missing licenses array' };
  const licenses = raw.map(mapLicenseRecord).filter(Boolean);
  return {
    ok: true,
    value: {
      customerId: asString(record?.customerId) ?? asString(asRecord(raw[0])?.customerId) ?? '',
      licenses,
    },
  };
}

function validatePortalView(value: unknown): { ok: true; value: unknown } | { ok: false; detail: string } {
  const record = asRecord(value);
  if (!record) return { ok: false, detail: 'not an object' };

  const org = asRecord(record.organization);
  if (!org) return { ok: false, detail: 'missing organization' };

  const active = asArray(asRecord(record.access)?.active) ?? [];
  const scheduled = asArray(asRecord(record.access)?.scheduled) ?? [];

  return {
    ok: true,
    value: {
      organization: {
        customerId: asString(org.customerId) ?? asString(record.customerId) ?? '',
        name: asString(org.name) ?? null,
        status: asString(org.status) ?? null,
      },
      commercial: asRecord(record.commercial) ? {
        model: asString(asRecord(record.commercial)?.model) ?? 'negotiated_agreement',
        effectiveDate: asString(asRecord(record.commercial)?.effectiveDate) ?? '',
        endDate: asString(asRecord(record.commercial)?.endDate) ?? null,
        renewalDate: asString(asRecord(record.commercial)?.renewalDate) ?? null,
      } : null,
      prepaid: asRecord(record.prepaid) ? {
        balanceTokens: asNumber(asRecord(record.prepaid)?.balanceTokens) ?? null,
        warningThresholdTokens: asNumber(asRecord(record.prepaid)?.warningThresholdTokens) ?? null,
      } : null,
      features: (asArray(record.features) ?? []).map(asString).filter(Boolean) as string[],
      access: {
        active: active.map((a) => {
          const g = asRecord(a);
          return g ? {
            grantId: asString(g.grantId) ?? '',
            agentProductId: asString(g.agentProductId) ?? '',
            agentName: asString(g.agentName) ?? '',
            category: asString(g.category) ?? null,
            version: asString(g.version) ?? null,
            status: asString(g.status) as any ?? 'active',
            startsAt: asString(g.startsAt) ?? '',
            endsAt: asString(g.endsAt) ?? null,
            licenseId: asString(g.licenseId) ?? null,
            deploymentId: asString(g.deploymentId) ?? null,
          } : null;
        }).filter(Boolean),
        scheduled: scheduled.map((a) => {
          const g = asRecord(a);
          return g ? {
            grantId: asString(g.grantId) ?? '',
            agentProductId: asString(g.agentProductId) ?? '',
            agentName: asString(g.agentName) ?? '',
            category: asString(g.category) ?? null,
            version: asString(g.version) ?? null,
            status: asString(g.status) as any ?? 'active',
            startsAt: asString(g.startsAt) ?? '',
            endsAt: asString(g.endsAt) ?? null,
            licenseId: asString(g.licenseId) ?? null,
            deploymentId: asString(g.deploymentId) ?? null,
          } : null;
        }).filter(Boolean),
      },
      lastUpdated: asString(record.lastUpdated) ?? new Date().toISOString(),
    },
  };
}