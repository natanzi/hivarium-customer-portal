/**
 * `/api/v1/*` handlers.
 *
 * Every handler derives the customer id and actor from the verified identity
 * and is tenant-scoped by construction. Upstream failures never fabricate
 * data: missing or broken service integrations surface as typed 503s that the
 * UI renders as unavailable states.
 */

import type {
  AccountStatus,
  AgentProduct,
  AgentsData,
  CustomerRequestDto,
  LicensesData,
  MachineAccountStatus,
  OverviewData,
  RequestListPage,
  SessionAccountStatus,
  SubscriptionData,
  UsageData,
} from '../../shared/types';
import {
  addCustomerComment,
  cancelRequest,
  createRequest,
  getRequestDetail,
  listRequests,
  type CancelOutcome,
  type CommentOutcome,
  type CreateRequestOutcome,
  type RequestActor,
} from '../db/repos/requests';
import { ApiError } from './errors';
import { validateComment, validateCreateRequest } from './validation';
import type { OperatorPort, UpstreamError } from '../services/operator';
import type { LicensePort } from '../services/license';
import type { PortalIdentity } from '../auth/context';
import { canCancelRequests, canCommentOnRequests, canSubmitRequestType } from '../auth/roles';
import type { RequestStatus } from '../../shared/types';

export interface HandlerContext {
  db: D1Database;
  identity: PortalIdentity;
  correlationId: string;
  operator: OperatorPort;
  license: LicensePort;
}

export function upstreamHttpError(error: UpstreamError): ApiError {
  if (error.code === 'missing_binding') {
    return new ApiError(503, 'service_unavailable', 'This section is temporarily unavailable. Please try again later.');
  }
  return new ApiError(503, 'upstream_unavailable', 'This section is temporarily unavailable. Please try again later.');
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export async function handleAccountStatus(ctx: HandlerContext): Promise<AccountStatus> {
  if (ctx.identity.kind === 'machine') {
    const status: MachineAccountStatus = {
      auth: 'machine',
      client: { id: ctx.identity.client.id, name: ctx.identity.client.name },
      organization: { customerId: ctx.identity.customerId },
      scopes: ctx.identity.scopes,
      capabilities: ctx.identity.capabilities,
    };
    return status;
  }

  const profile = await ctx.operator.getCustomerProfile(ctx.identity.customerId);
  const status: SessionAccountStatus = {
    auth: 'session',
    user: {
      email: ctx.identity.membership.emailNormalized,
      displayName: ctx.identity.membership.displayName || ctx.identity.membership.emailNormalized,
      role: ctx.identity.role,
    },
    capabilities: ctx.identity.capabilities,
    organization: {
      customerId: ctx.identity.customerId,
      name: profile.ok ? profile.value.name : null,
    },
    signOutUrl: '/cdn-cgi/access/logout',
  };
  return status;
}

// ---------------------------------------------------------------------------
// Read sections
// ---------------------------------------------------------------------------

export async function handleOverview(ctx: HandlerContext): Promise<OverviewData> {
  const customerId = ctx.identity.customerId;

  const [profile, commercial, access, licenseResult, requestPage] = await Promise.all([
    ctx.operator.getCustomerProfile(customerId),
    ctx.operator.getCommercial(customerId),
    ctx.operator.getAccess(customerId),
    ctx.license.getLicenses(customerId),
    listRequests(ctx.db, { customerId, page: 1, pageSize: 5 }),
  ]);

  const activeArrangement =
    commercial.ok && commercial.value.active.length > 0 ? commercial.value.active[0] : null;

  const recent: OverviewData['requests']['recent'] = requestPage.requests.map((r) => ({
    id: r.id,
    requestType: r.requestType,
    status: r.status,
    title: r.title,
    createdAt: r.createdAt,
  }));

  const licenseOk = licenseResult.ok;
  const activeLicenses = licenseOk
    ? licenseResult.value.licenses.filter((l) => l.status === 'active').length
    : null;
  const activeDeployments = licenseOk
    ? licenseResult.value.licenses.reduce((sum, l) => sum + l.deployments.length, 0)
    : null;

  return {
    organization: {
      customerId,
      name: profile.ok ? profile.value.name : null,
    },
    relationship: {
      status: profile.ok ? profile.value.status : null,
      commercialModel: activeArrangement?.model ?? null,
      periodEnd: activeArrangement?.endDate ?? activeArrangement?.renewalDate ?? null,
      prepaidBalanceTokens:
        activeArrangement?.model === 'prepaid_tokens' ? activeArrangement.prepaidBalanceTokens : null,
    },
    agentSummary: {
      active: access.ok ? access.value.current.length : null,
      scheduled: access.ok ? access.value.scheduled.length : null,
    },
    licenseSummary: {
      activeLicenses,
      activeDeployments,
    },
    requests: {
      outstanding: requestPage.requests.filter((r) => ['submitted', 'in_review'].includes(r.status)).length +
        Math.max(0, requestPage.total - requestPage.requests.length),
      recent,
    },
    availability: {
      operator: labelForResult(profile),
      license: labelForResult(licenseResult),
    },
  };
}

function labelForResult<T>(result: { ok: boolean; error?: UpstreamError }): 'ok' | 'unavailable' | 'missing' {
  if (result.ok) return 'ok';
  return result.error?.code === 'missing_binding' ? 'missing' : 'unavailable';
}

export async function handleSubscription(ctx: HandlerContext): Promise<SubscriptionData> {
  const result = await ctx.operator.getCommercial(ctx.identity.customerId);
  if (!result.ok) throw upstreamHttpError(result.error);
  return { commercial: result.value, availability: { operator: 'ok', license: 'ok' } };
}

export async function handleAgents(ctx: HandlerContext): Promise<AgentsData> {
  const [access, catalog] = await Promise.all([
    ctx.operator.getAccess(ctx.identity.customerId),
    ctx.operator.getAgentCatalog(),
  ]);
  if (!access.ok) throw upstreamHttpError(access.error);
  const products: AgentProduct[] = catalog.ok ? catalog.value : [];
  return {
    access: access.value,
    catalog: products,
    availability: {
      operator: labelForResult(access),
      license: 'ok',
    },
  };
}

export async function handleLicenses(ctx: HandlerContext): Promise<LicensesData> {
  const result = await ctx.license.getLicenses(ctx.identity.customerId);
  if (!result.ok) throw upstreamHttpError(result.error);
  return { licenses: result.value, availability: { operator: 'ok', license: 'ok' } };
}

export async function handleUsage(ctx: HandlerContext): Promise<UsageData> {
  const customerId = ctx.identity.customerId;
  const [commercial, ledger, summary] = await Promise.all([
    ctx.operator.getCommercial(customerId),
    ctx.operator.getLedger(customerId),
    ctx.operator.getUsageSummary(customerId),
  ]);
  if (!commercial.ok) throw upstreamHttpError(commercial.error);

  const active = commercial.value.active[0];
  const isPrepaid =
    active?.model === 'prepaid_tokens' ||
    (active?.model === 'negotiated_agreement' && active.prepaidBalanceTokens !== null);

  if (isPrepaid) {
    if (!ledger.ok) throw upstreamHttpError(ledger.error);
    return {
      kind: 'prepaid',
      balanceTokens: ledger.value.balanceTokens,
      warningThresholdTokens: active?.warningThresholdTokens ?? null,
      ledger: ledger.value.rows,
      availability: { operator: 'ok', license: 'ok' },
    };
  }

  if (!summary.ok) throw upstreamHttpError(summary.error);
  return {
    kind: 'commercial',
    model: active?.model ?? 'negotiated_agreement',
    summary: summary.value,
    availability: { operator: 'ok', license: 'ok' },
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function actorFor(identity: PortalIdentity): RequestActor {
  if (identity.kind === 'session') {
    return {
      membershipId: identity.membership.id,
      email: identity.membership.emailNormalized,
      displayName: identity.membership.displayName,
      label: 'portal',
    };
  }
  return {
    membershipId: `machine:${identity.client.id}`,
    email: `machine:${identity.client.name}`,
    displayName: identity.client.name,
    label: 'machine',
  };
}

function requireScope(identity: PortalIdentity, scope: string): void {
  if (identity.kind === 'machine' && !identity.scopes.includes(scope)) {
    throw new ApiError(403, 'forbidden', 'This credential does not have the required scope.');
  }
}

const ALL_REQUEST_STATUSES: RequestStatus[] = ['submitted', 'in_review', 'approved', 'rejected', 'completed', 'cancelled'];

export async function handleListRequests(
  ctx: HandlerContext,
  params: { page?: string; pageSize?: string; status?: string },
): Promise<RequestListPage> {
  const page = clampPositive(params.page, 1);
  const pageSize = clampPositive(params.pageSize, 20, 50);
  let status: RequestStatus | undefined;
  if (params.status) {
    if (!ALL_REQUEST_STATUSES.includes(params.status as RequestStatus)) {
      throw new ApiError(400, 'validation_error', 'Invalid status filter.');
    }
    status = params.status as RequestStatus;
  }
  requireScope(ctx.identity, 'requests:read');
  const result = await listRequests(ctx.db, {
    customerId: ctx.identity.customerId,
    page,
    pageSize,
    status,
  });
  return { ...result, page, pageSize };
}

function clampPositive(value: string | undefined, fallback: number, max = 100): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function handleCreateRequest(
  ctx: HandlerContext,
  body: unknown,
  idempotencyHeader?: string | null,
): Promise<{ request: CustomerRequestDto; replayed: boolean }> {
  if (ctx.identity.kind === 'machine') {
    requireScope(ctx.identity, 'requests:write');
    if (!idempotencyHeader) {
      throw new ApiError(400, 'validation_error', 'Machine clients must send an Idempotency-Key header.');
    }
  }

  const merged =
    ctx.identity.kind === 'machine'
      ? { ...(body as Record<string, unknown>), idempotencyKey: idempotencyHeader }
      : body;

  const validation = validateCreateRequest(merged);
  if (!validation.ok) {
    throw new ApiError(400, 'validation_error', validation.problems.join(' '));
  }
  const input = validation.value;

  if (ctx.identity.kind === 'session' && !canSubmitRequestType(ctx.identity.role, input.requestType)) {
    throw new ApiError(403, 'forbidden', 'Your role does not allow submitting this request type.');
  }

  const outcome: CreateRequestOutcome = await createRequest(ctx.db, {
    customerId: ctx.identity.customerId,
    actor: actorFor(ctx.identity),
    requestType: input.requestType,
    title: input.title,
    reason: input.reason,
    payload: input.payload as Record<string, unknown>,
    idempotencyKey: input.idempotencyKey,
    correlationId: ctx.correlationId,
  });

  if (outcome.outcome === 'conflict') {
    throw new ApiError(409, 'conflict', 'This idempotency key was already used with a different payload.');
  }

  return { request: outcome.request, replayed: outcome.outcome === 'replayed' };
}

export async function handleRequestDetail(
  ctx: HandlerContext,
  requestId: string,
): Promise<CustomerRequestDto> {
  requireScope(ctx.identity, 'requests:read');
  const detail = await getRequestDetail(ctx.db, ctx.identity.customerId, requestId);
  if (!detail) {
    throw new ApiError(404, 'not_found', 'Request not found.');
  }
  return detail;
}

export async function handleCancelRequest(
  ctx: HandlerContext,
  requestId: string,
): Promise<{ request: CustomerRequestDto }> {
  if (ctx.identity.kind !== 'session') {
    throw new ApiError(403, 'forbidden', 'This operation is not available to machine clients.');
  }
  const identity = ctx.identity;
  const existing = await getRequestDetail(ctx.db, identity.customerId, requestId);
  if (!existing) {
    throw new ApiError(404, 'not_found', 'Request not found.');
  }
  const isRequester = existing.requestedBy.membershipId === identity.membership.id;
  if (!canCancelRequests(identity.role) && !isRequester) {
    throw new ApiError(403, 'forbidden', 'You are not allowed to cancel this request.');
  }

  const outcome: CancelOutcome = await cancelRequest(ctx.db, {
    customerId: identity.customerId,
    requestId,
    actor: actorFor(identity),
    correlationId: ctx.correlationId,
  });

  if (outcome === 'not_found') throw new ApiError(404, 'not_found', 'Request not found.');
  if (outcome === 'invalid_transition') {
    throw new ApiError(409, 'conflict', 'Only submitted requests can be cancelled.');
  }
  const request = await getRequestDetail(ctx.db, identity.customerId, requestId);
  if (!request) throw new ApiError(404, 'not_found', 'Request not found.');
  return { request };
}

export async function handleAddComment(
  ctx: HandlerContext,
  requestId: string,
  body: unknown,
): Promise<{ request: CustomerRequestDto }> {
  if (ctx.identity.kind !== 'session') {
    throw new ApiError(403, 'forbidden', 'This operation is not available to machine clients.');
  }
  if (!canCommentOnRequests(ctx.identity.role)) {
    throw new ApiError(403, 'forbidden', 'Your role does not allow commenting.');
  }
  const validation = validateComment(body);
  if (!validation.ok) {
    throw new ApiError(400, 'validation_error', validation.problems.join(' '));
  }
  const existing = await getRequestDetail(ctx.db, ctx.identity.customerId, requestId);
  if (!existing) throw new ApiError(404, 'not_found', 'Request not found.');

  const outcome: CommentOutcome = await addCustomerComment(ctx.db, {
    customerId: ctx.identity.customerId,
    requestId,
    actor: actorFor(ctx.identity),
    message: validation.value.message,
    correlationId: ctx.correlationId,
  });
  if (outcome === 'not_found') throw new ApiError(404, 'not_found', 'Request not found.');
  if (outcome === 'invalid_transition') {
    throw new ApiError(409, 'conflict', 'Cancelled requests cannot receive comments.');
  }
  const request = await getRequestDetail(ctx.db, ctx.identity.customerId, requestId);
  if (!request) throw new ApiError(404, 'not_found', 'Request not found.');
  return { request };
}