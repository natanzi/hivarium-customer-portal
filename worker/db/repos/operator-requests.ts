/**
 * Operator Console inbound request repository.
 *
 * Reads and operator decisions are not tenant-scoped: the caller is a verified
 * service principal, not a customer. Customer-facing APIs continue to bind
 * every query to the verified customer_id.
 */

import type { RequestStatus, RequestType } from '../../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../../shared/types';
import type {
  OperatorDecisionResponse,
  OperatorRequestDetail,
  OperatorRequestEvent,
  OperatorRequestSummary,
  OperatorSubmittedBy,
} from '../../../shared/operator-service';
import { OPERATOR_SERVICE_API_VERSION } from '../../../shared/operator-service';
import {
  canOperatorTransition,
  statusForDecision,
  type OperatorDecision,
} from '../../domain/request-lifecycle';
import { OPERATOR_SERVICE_NAME, type OperatorServicePrincipal } from '../../auth/service-principal';
import { canonicalJson, isoNow, newId, parseJsonObject, sha256Hex } from '../../util';
import { IDEMPOTENCY_TTL_MS } from './requests';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface RequestDbRow {
  id: string;
  customer_id: string;
  requested_by_membership_id: string;
  request_type: string;
  status: string;
  title: string;
  reason: string;
  structured_payload_json: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  submitter_email: string | null;
  submitter_name: string | null;
}

interface EventDbRow {
  id: string;
  request_id: string;
  event_type: string;
  actor_type: string;
  actor_reference: string;
  message: string;
  metadata_json: string;
  created_at: string;
}

const REQUEST_SELECT = `
  SELECT r.id, r.customer_id, r.requested_by_membership_id, r.request_type, r.status, r.title,
         r.reason, r.structured_payload_json, r.idempotency_key, r.created_at, r.updated_at,
         r.cancelled_at, r.completed_at,
         m.email_normalized AS submitter_email, m.display_name AS submitter_name
  FROM customer_requests r
  LEFT JOIN portal_memberships m
    ON m.id = r.requested_by_membership_id AND m.customer_id = r.customer_id
`;

export interface OperatorListFilters {
  customerId?: string;
  status?: RequestStatus;
  requestType?: RequestType;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export function defaultOperatorListLimit(): number {
  return DEFAULT_LIMIT;
}

export function maxOperatorListLimit(): number {
  return MAX_LIMIT;
}

function submittedBy(row: RequestDbRow): OperatorSubmittedBy {
  if (row.submitter_email && row.submitter_name) {
    return { displayName: row.submitter_name, email: row.submitter_email };
  }
  if (row.requested_by_membership_id.startsWith('machine:')) {
    return { displayName: row.requested_by_membership_id, email: '' };
  }
  return { displayName: 'Unknown member', email: 'unknown' };
}

function toSummary(row: RequestDbRow): OperatorRequestSummary {
  return {
    requestId: row.id,
    customerId: row.customer_id,
    requestType: row.request_type as RequestType,
    status: row.status as RequestStatus,
    summary: row.reason.trim() || row.title || REQUEST_TYPE_LABELS[row.request_type as RequestType],
    submittedBy: submittedBy(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOperatorEvent(row: EventDbRow): OperatorRequestEvent {
  const metadata = parseJsonObject(row.metadata_json) ?? {};
  const previousStatus = typeof metadata.previousStatus === 'string' ? (metadata.previousStatus as RequestStatus) : null;
  const resultingStatus = typeof metadata.resultingStatus === 'string' ? (metadata.resultingStatus as RequestStatus) : null;
  const operatorNote = typeof metadata.operatorNote === 'string' && metadata.operatorNote.length > 0 ? metadata.operatorNote : null;
  return {
    eventId: row.id,
    requestId: row.request_id,
    previousStatus,
    resultingStatus,
    eventType: row.event_type,
    occurredAt: row.created_at,
    principalType: typeof metadata.principalType === 'string' ? metadata.principalType : row.actor_type,
    principalIdentifier: typeof metadata.principalIdentifier === 'string' ? metadata.principalIdentifier : row.actor_reference,
    idempotencyKeyHash: typeof metadata.idempotencyKeyHash === 'string' ? metadata.idempotencyKeyHash : null,
    externalReference: typeof metadata.externalReference === 'string' ? metadata.externalReference : null,
    customerVisibleMessage: row.message,
    operatorNote,
  };
}

async function loadEvents(db: D1Database, requestId: string): Promise<OperatorRequestEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id, request_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
       FROM customer_request_events
       WHERE request_id = ?1
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(requestId)
    .all<EventDbRow>();
  return rows.results.map(mapOperatorEvent);
}

async function loadDetail(db: D1Database, requestId: string): Promise<OperatorRequestDetail | null> {
  const row = await db.prepare(`${REQUEST_SELECT} WHERE r.id = ?1`).bind(requestId).first<RequestDbRow>();
  if (!row) return null;
  const events = await loadEvents(db, requestId);
  const summary = toSummary(row);
  return {
    ...summary,
    title: row.title,
    reason: row.reason,
    payload: parseJsonObject(row.structured_payload_json) ?? {},
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    events,
  };
}

export async function listRequestsForOperator(
  db: D1Database,
  filters: OperatorListFilters,
): Promise<{ items: OperatorRequestSummary[]; nextCursor: string | null }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.customerId) {
    where.push(`r.customer_id = ?${binds.length + 1}`);
    binds.push(filters.customerId);
  }
  if (filters.status) {
    where.push(`r.status = ?${binds.length + 1}`);
    binds.push(filters.status);
  }
  if (filters.requestType) {
    where.push(`r.request_type = ?${binds.length + 1}`);
    binds.push(filters.requestType);
  }
  if (filters.cursor) {
    where.push(
      `(r.created_at < ?${binds.length + 1} OR (r.created_at = ?${binds.length + 1} AND r.id < ?${binds.length + 2}))`,
    );
    binds.push(filters.cursor.createdAt, filters.cursor.id);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit;
  const rows = await db
    .prepare(
      `${REQUEST_SELECT} ${whereSql}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?${binds.length + 1}`,
    )
    .bind(...binds, limit + 1)
    .all<RequestDbRow>();

  const page = rows.results.slice(0, limit);
  const hasMore = rows.results.length > limit;
  const last = page[page.length - 1];
  return {
    items: page.map(toSummary),
    nextCursor: hasMore && last ? encodeOperatorCursor(last.created_at, last.id) : null,
  };
}

export async function getRequestForOperator(
  db: D1Database,
  requestId: string,
): Promise<OperatorRequestDetail | null> {
  return loadDetail(db, requestId);
}

export type OperatorDecisionOutcome =
  | { outcome: 'applied'; response: OperatorDecisionResponse }
  | { outcome: 'replayed'; response: OperatorDecisionResponse }
  | { outcome: 'conflict' }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition' };

export async function applyOperatorDecision(
  db: D1Database,
  input: {
    requestId: string;
    decision: OperatorDecision;
    operatorNote?: string;
    customerVisibleMessage?: string;
    externalReference?: string;
    idempotencyKey: string;
    principal: OperatorServicePrincipal;
    correlationId: string;
    now?: string;
  },
): Promise<OperatorDecisionOutcome> {
  const now = input.now ?? isoNow();
  const resultingStatus = statusForDecision(input.decision);
  const payloadHash = await sha256Hex(
    canonicalJson({
      decision: input.decision,
      operatorNote: input.operatorNote ?? '',
      customerVisibleMessage: input.customerVisibleMessage ?? '',
      externalReference: input.externalReference ?? '',
    }),
  );
  const idempotencyKeyHash = await sha256Hex(input.idempotencyKey);
  const operation = `request.decision:${input.requestId}`;

  const existingRequest = await db
    .prepare(`SELECT id, customer_id, status FROM customer_requests WHERE id = ?1`)
    .bind(input.requestId)
    .first<{ id: string; customer_id: string; status: string }>();
  if (!existingRequest) return { outcome: 'not_found' };

  const customerId = existingRequest.customer_id;
  const previousStatus = existingRequest.status as RequestStatus;

  const prunedAt = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
  await db
    .prepare(`DELETE FROM idempotency_records WHERE customer_id = ?1 AND expires_at < ?2`)
    .bind(customerId, prunedAt)
    .run();

  const existing = await db
    .prepare(
      `SELECT request_hash, response_body_json
       FROM idempotency_records
       WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
    )
    .bind(customerId, operation, input.idempotencyKey)
    .first<{ request_hash: string; response_body_json: string }>();

  if (existing) {
    if (existing.request_hash !== payloadHash) return { outcome: 'conflict' };
    const stored = parseStoredDecision(existing.response_body_json);
    if (!stored) return { outcome: 'conflict' };
    return { outcome: 'replayed', response: stored };
  }

  if (!canOperatorTransition(previousStatus, resultingStatus)) {
    return { outcome: 'invalid_transition' };
  }

  const eventId = newId('evt');
  const completedAt = resultingStatus === 'completed' ? now : null;
  const customerVisibleMessage =
    input.customerVisibleMessage ??
    (resultingStatus === 'needs_information'
      ? 'Additional information is required.'
      : `Status changed to ${resultingStatus}.`);

  const metadata = {
    previousStatus,
    resultingStatus,
    principalType: input.principal.principalType,
    principalIdentifier: input.principal.serviceName,
    serviceName: input.principal.serviceName,
    idempotencyKeyHash,
    externalReference: input.externalReference ?? null,
    operatorNote: input.operatorNote ?? null,
    customerVisible: true,
  };

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_records
        (id, customer_id, operation, idempotency_key, request_hash, response_status, response_body_json, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(newId('idem'), customerId, operation, input.idempotencyKey, payloadHash, 200, '{}', now, expiresAt)
    .run();

  if (claim.meta.changes === 0) {
    const winner = await db
      .prepare(
        `SELECT request_hash, response_body_json
         FROM idempotency_records
         WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
      )
      .bind(customerId, operation, input.idempotencyKey)
      .first<{ request_hash: string; response_body_json: string }>();
    if (!winner || winner.request_hash !== payloadHash) return { outcome: 'conflict' };
    const stored = parseStoredDecision(winner.response_body_json);
    if (!stored) return { outcome: 'conflict' };
    return { outcome: 'replayed', response: stored };
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE customer_requests
         SET status = ?1, updated_at = ?2, completed_at = CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE completed_at END
         WHERE id = ?4 AND status = ?5`,
      )
      .bind(resultingStatus, now, completedAt, input.requestId, previousStatus),
    db
      .prepare(
        `INSERT INTO customer_request_events
          (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'status_changed', 'operator', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        eventId,
        input.requestId,
        customerId,
        OPERATOR_SERVICE_NAME,
        customerVisibleMessage,
        JSON.stringify(metadata),
        now,
      ),
    db
      .prepare(
        `INSERT INTO portal_audit_log
          (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
         VALUES (?1, ?2, ?3, 'request.operator_decision', 'customer_request', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        newId('aud'),
        customerId,
        `service:${OPERATOR_SERVICE_NAME}`,
        input.requestId,
        JSON.stringify({
          decision: input.decision,
          previousStatus,
          resultingStatus,
          principalType: input.principal.principalType,
          serviceName: input.principal.serviceName,
          idempotencyKeyHash,
        }),
        input.correlationId,
        now,
      ),
  ]);

  if (results[0].meta.changes === 0) {
    return { outcome: 'invalid_transition' };
  }

  const detail = await loadDetail(db, input.requestId);
  if (!detail) return { outcome: 'conflict' };
  const response: OperatorDecisionResponse = {
    apiVersion: OPERATOR_SERVICE_API_VERSION,
    request: detail,
    replayed: false,
  };
  await db
    .prepare(
      `UPDATE idempotency_records
       SET response_body_json = ?1
       WHERE customer_id = ?2 AND operation = ?3 AND idempotency_key = ?4`,
    )
    .bind(JSON.stringify(response), customerId, operation, input.idempotencyKey)
    .run();
  return { outcome: 'applied', response };
}

function parseStoredDecision(body: string): OperatorDecisionResponse | null {
  try {
    const parsed = JSON.parse(body) as OperatorDecisionResponse;
    if (parsed?.apiVersion !== OPERATOR_SERVICE_API_VERSION || !parsed.request?.requestId) return null;
    return { ...parsed, replayed: true };
  } catch {
    return null;
  }
}

export function encodeOperatorCursor(createdAt: string, id: string): string {
  const bytes = new TextEncoder().encode(`${createdAt}\n${id}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeOperatorCursor(value: string): { createdAt: string; id: string } | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    const split = decoded.indexOf('\n');
    if (split <= 0) return null;
    const createdAt = decoded.slice(0, split);
    const id = decoded.slice(split + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
