/**
 * `/service/v1/*` Operator Console request APIs.
 *
 * Authenticated only by a verified operator-console service principal.
 * Customer JWTs and machine credentials never authorize these routes.
 */

import type { RequestType } from '../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../shared/types';
import { OPERATOR_SERVICE_API_VERSION } from '../../shared/operator-service';
import { ApiError } from './errors';
import { isValidIdempotencyKey } from './validation';
import {
  isOperatorDecision,
  isRequestStatus,
} from '../domain/request-lifecycle';
import type { OperatorServicePrincipal } from '../auth/service-principal';
import {
  applyOperatorDecision,
  decodeOperatorCursor,
  defaultOperatorListLimit,
  getRequestForOperator,
  listRequestsForOperator,
  maxOperatorListLimit,
} from '../db/repos/operator-requests';

const REQUEST_TYPES = new Set<RequestType>(Object.keys(REQUEST_TYPE_LABELS) as RequestType[]);
const MAX_STRING = 2000;
const MAX_CUSTOMER_ID = 128;
const MAX_REQUEST_ID = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalBoundedString(value: unknown, max: number): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export async function handleOperatorListRequests(
  db: D1Database,
  search: URLSearchParams,
): Promise<unknown> {
  const customerId = search.get('customerId') ?? undefined;
  const statusRaw = search.get('status') ?? undefined;
  const requestTypeRaw = search.get('requestType') ?? undefined;
  const cursorRaw = search.get('cursor') ?? undefined;
  const limitRaw = search.get('limit') ?? undefined;

  if (customerId !== undefined && (customerId.trim().length === 0 || customerId.length > MAX_CUSTOMER_ID)) {
    throw new ApiError(400, 'invalid_request', 'customerId is invalid.');
  }
  if (statusRaw !== undefined && !isRequestStatus(statusRaw)) {
    throw new ApiError(400, 'invalid_request', 'status is invalid.');
  }
  if (requestTypeRaw !== undefined && !REQUEST_TYPES.has(requestTypeRaw as RequestType)) {
    throw new ApiError(400, 'invalid_request', 'requestType is invalid.');
  }

  let limit = defaultOperatorListLimit();
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxOperatorListLimit()) {
      throw new ApiError(400, 'invalid_request', `limit must be an integer between 1 and ${maxOperatorListLimit()}.`);
    }
    limit = parsed;
  }

  let cursor: { createdAt: string; id: string } | undefined;
  if (cursorRaw !== undefined) {
    const decoded = decodeOperatorCursor(cursorRaw);
    if (!decoded) throw new ApiError(400, 'invalid_request', 'cursor is invalid.');
    cursor = decoded;
  }

  const page = await listRequestsForOperator(db, {
    customerId: customerId?.trim(),
    status: statusRaw && isRequestStatus(statusRaw) ? statusRaw : undefined,
    requestType: requestTypeRaw && REQUEST_TYPES.has(requestTypeRaw as RequestType) ? (requestTypeRaw as RequestType) : undefined,
    cursor,
    limit,
  });
  return { apiVersion: OPERATOR_SERVICE_API_VERSION, items: page.items, nextCursor: page.nextCursor };
}

export async function handleOperatorGetRequest(db: D1Database, requestId: string): Promise<unknown> {
  if (!requestId || requestId.length > MAX_REQUEST_ID) {
    throw new ApiError(400, 'invalid_request', 'requestId is invalid.');
  }
  const request = await getRequestForOperator(db, requestId);
  if (!request) throw new ApiError(404, 'request_not_found', 'Request not found.');
  return { apiVersion: OPERATOR_SERVICE_API_VERSION, request };
}

export async function handleOperatorDecision(
  db: D1Database,
  requestId: string,
  body: unknown,
  principal: OperatorServicePrincipal,
  correlationId: string,
): Promise<unknown> {
  if (!requestId || requestId.length > MAX_REQUEST_ID) {
    throw new ApiError(400, 'invalid_request', 'requestId is invalid.');
  }
  if (!isRecord(body)) {
    throw new ApiError(400, 'invalid_request', 'Request body must be a JSON object.');
  }
  const allowed = ['decision', 'operatorNote', 'customerVisibleMessage', 'externalReference', 'idempotencyKey'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new ApiError(400, 'invalid_request', `Unexpected field "${key}".`);
    }
  }
  if (!isOperatorDecision(body.decision)) {
    throw new ApiError(400, 'invalid_request', 'decision is invalid.');
  }
  if (!isValidIdempotencyKey(body.idempotencyKey)) {
    throw new ApiError(400, 'invalid_request', 'idempotencyKey must be 8-128 characters of letters, digits, dot, dash or underscore.');
  }
  if (!optionalBoundedString(body.operatorNote, MAX_STRING)) {
    throw new ApiError(400, 'invalid_request', 'operatorNote is invalid.');
  }
  if (!optionalBoundedString(body.customerVisibleMessage, MAX_STRING)) {
    throw new ApiError(400, 'invalid_request', 'customerVisibleMessage is invalid.');
  }
  if (!optionalBoundedString(body.externalReference, 256)) {
    throw new ApiError(400, 'invalid_request', 'externalReference is invalid.');
  }

  const outcome = await applyOperatorDecision(db, {
    requestId,
    decision: body.decision,
    operatorNote: typeof body.operatorNote === 'string' ? body.operatorNote.trim() : undefined,
    customerVisibleMessage: typeof body.customerVisibleMessage === 'string' ? body.customerVisibleMessage.trim() : undefined,
    externalReference: typeof body.externalReference === 'string' ? body.externalReference.trim() : undefined,
    idempotencyKey: body.idempotencyKey,
    principal,
    correlationId,
  });

  if (outcome.outcome === 'not_found') throw new ApiError(404, 'request_not_found', 'Request not found.');
  if (outcome.outcome === 'invalid_transition') {
    throw new ApiError(409, 'invalid_transition', 'This decision is not valid for the current request status.');
  }
  if (outcome.outcome === 'conflict') {
    throw new ApiError(409, 'idempotency_conflict', 'This idempotency key was already used with a different payload.');
  }
  return outcome.response;
}
