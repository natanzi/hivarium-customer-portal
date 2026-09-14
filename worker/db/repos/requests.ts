/**
 * customer_requests repository.
 *
 * Creation, cancellation and commenting are transaction-safe (single D1 batch)
 * and strictly tenant-scoped: every read and write carries `customer_id` from
 * the verified identity, never from client input.
 *
 * Request events are append-only by construction: the repository exposes no
 * update or delete path for `customer_request_events`.
 */

import type {
  CustomerRequestDto,
  RequestEventDto,
  RequestEventType,
  RequestStatus,
  RequestType,
} from '../../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../../shared/types';
import { canonicalJson, isoNow, newId, parseJsonObject, sha256Hex } from '../../util';
import { canCustomerCancel, canCustomerResubmit } from '../../domain/request-lifecycle';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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

export interface RequestActor {
  membershipId: string;
  email: string;
  displayName: string;
  /** For machine clients: stable label; the audit entry carries the client id. */
  label: string;
}

export type CreateRequestOutcome =
  | { outcome: 'created'; request: CustomerRequestDto }
  | { outcome: 'replayed'; request: CustomerRequestDto }
  | { outcome: 'conflict' };

const REQUEST_SELECT = `
  SELECT id, customer_id, requested_by_membership_id, request_type, status, title,
         reason, structured_payload_json, idempotency_key, created_at, updated_at,
         cancelled_at, completed_at
  FROM customer_requests
`;

function mapRequest(row: RequestDbRow): Omit<CustomerRequestDto, 'requestedBy'> {
  return {
    id: row.id,
    customerId: row.customer_id,
    requestType: row.request_type as RequestType,
    status: row.status as RequestStatus,
    title: row.title,
    reason: row.reason,
    payload: parseJsonObject(row.structured_payload_json) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
  };
}

const CUSTOMER_HIDDEN_METADATA_KEYS = [
  'operatorNote',
  'principalType',
  'principalIdentifier',
  'idempotencyKeyHash',
  'externalReference',
  'serviceName',
] as const;

function publicEventMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if ((CUSTOMER_HIDDEN_METADATA_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

function mapEvent(row: EventDbRow): RequestEventDto {
  const metadata = publicEventMetadata(parseJsonObject(row.metadata_json) ?? {});
  const actorType = row.actor_type as 'customer' | 'operator' | 'system';
  let actorLabel: string;
  if (actorType === 'customer') {
    actorLabel = 'Customer';
  } else if (actorType === 'operator') {
    actorLabel = 'Hivarium';
  } else {
    actorLabel = 'System';
  }
  return {
    id: row.id,
    requestId: row.request_id,
    eventType: row.event_type as RequestEventType,
    actorType,
    actorReference: row.actor_reference,
    actorLabel,
    message: row.message,
    metadata,
    createdAt: row.created_at,
  };
}

export interface CreateRequestInput {
  customerId: string;
  actor: RequestActor;
  requestType: RequestType;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
  now?: string;
}

/**
 * Creates a request, its initial `created` event, an audit record and an
 * idempotency record. Duplicate keys with an identical payload replay the
 * original response; duplicate keys with a different payload yield a
 * conflict.
 *
 * Concurrency note: the idempotency record is claimed with its own
 * INSERT OR IGNORE BEFORE the request/event/audit batch. D1 batches do not
 * abort when an OR IGNORE statement matches (0 changes is not a failure), so
 * bundling the claim inside the same batch as the inserts would duplicate the
 * request row under a true concurrent race. Claiming first keeps exactly one
 * writer; losers resolve to replay/conflict.
 */
export async function createRequest(
  db: D1Database,
  input: CreateRequestInput,
): Promise<CreateRequestOutcome> {
  const now = input.now ?? isoNow();
  const operation = 'request.create';
  const requestHash = await sha256Hex(
    canonicalJson({
      requestType: input.requestType,
      title: input.title,
      reason: input.reason,
      payload: input.payload,
    }),
  );

  // Prune expired records so their unique slot can be reused.
  const prunedAt = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
  await db
    .prepare(`DELETE FROM idempotency_records WHERE customer_id = ?1 AND expires_at < ?2`)
    .bind(input.customerId, prunedAt)
    .run();

  const existing = await db
    .prepare(
      `SELECT request_hash, response_status, response_body_json
       FROM idempotency_records
       WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
    )
    .bind(input.customerId, operation, input.idempotencyKey)
    .first<{ request_hash: string; response_status: number; response_body_json: string }>();

  if (existing) {
    return resolveExisting(db, input.customerId, operation, input.idempotencyKey, requestHash, existing.response_body_json);
  }

  const id = newId('req');
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const responseBody = JSON.stringify({ requestId: id });

  // Claim the idempotency slot. Exactly one concurrent writer wins.
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_records
        (id, customer_id, operation, idempotency_key, request_hash, response_status, response_body_json, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      newId('idem'),
      input.customerId,
      operation,
      input.idempotencyKey,
      requestHash,
      201,
      responseBody,
      now,
      expiresAt,
    )
    .run();

  if (claim.meta.changes === 0) {
    // Lost the race: the winner's record now exists; resolve against it.
    const winner = await db
      .prepare(
        `SELECT request_hash, response_body_json
         FROM idempotency_records
         WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
      )
      .bind(input.customerId, operation, input.idempotencyKey)
      .first<{ request_hash: string; response_body_json: string }>();
    if (!winner || winner.request_hash !== requestHash) return { outcome: 'conflict' };
    return resolveExisting(db, input.customerId, operation, input.idempotencyKey, requestHash, winner.response_body_json);
  }

  // We own the slot: request, initial event and audit land in one atomic
  // batch. If the batch fails, the claim remains and later replays resolve
  // to a safe conflict rather than fabricating a second request.
  await db.batch([
    db
      .prepare(
        `INSERT INTO customer_requests
          (id, customer_id, requested_by_membership_id, request_type, status, title, reason,
           structured_payload_json, idempotency_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'submitted', ?5, ?6, ?7, ?8, ?9, ?9)`,
      )
      .bind(
        id,
        input.customerId,
        input.actor.membershipId,
        input.requestType,
        input.title,
        input.reason,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        now,
      ),
    db
      .prepare(
        `INSERT INTO customer_request_events
          (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'created', ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        newId('evt'),
        id,
        input.customerId,
        actorTypeFor(input.actor),
        input.actor.membershipId,
        'Request submitted.',
        JSON.stringify({ idempotencyKey: input.idempotencyKey }),
        now,
      ),
    db
      .prepare(
        `INSERT INTO portal_audit_log
          (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
         VALUES (?1, ?2, ?3, 'request.create', 'customer_request', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        newId('aud'),
        input.customerId,
        input.actor.email,
        id,
        JSON.stringify({ requestType: input.requestType, via: input.actor.label }),
        input.correlationId,
        now,
      ),
  ]);

  const request = await getRequestById(db, input.customerId, id);
  if (!request) return { outcome: 'conflict' };
  return { outcome: 'created', request };
}

async function resolveExisting(
  db: D1Database,
  customerId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
  responseBody: string,
): Promise<CreateRequestOutcome> {
  const stored = await db
    .prepare(
      `SELECT request_hash, response_body_json
       FROM idempotency_records
       WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
    )
    .bind(customerId, operation, idempotencyKey)
    .first<{ request_hash: string; response_body_json: string }>();
  if (!stored || stored.request_hash !== requestHash) return { outcome: 'conflict' };
  const request = await getRequestById(db, customerId, parseStoredRequestId(responseBody));
  if (request) return { outcome: 'replayed', request };
  // Stored response references a request we cannot find (e.g. the claiming
  // writer crashed mid-batch): fail closed rather than fabricate a record.
  return { outcome: 'conflict' };
}

function parseStoredRequestId(body: string): string {
  const parsed = parseJsonObject(body);
  return typeof parsed?.requestId === 'string' ? parsed.requestId : '';
}

function actorTypeFor(actor: RequestActor): 'customer' | 'system' {
  return actor.label === 'machine' ? 'system' : 'customer';
}

export async function getRequestById(
  db: D1Database,
  customerId: string,
  requestId: string,
): Promise<CustomerRequestDto | null> {
  const row = await db
    .prepare(`${REQUEST_SELECT} WHERE id = ?1 AND customer_id = ?2`)
    .bind(requestId, customerId)
    .first<RequestDbRow>();
  if (!row) return null;
  const member = await db
    .prepare(
      `SELECT email_normalized, display_name FROM portal_memberships WHERE id = ?1 AND customer_id = ?2`,
    )
    .bind(row.requested_by_membership_id, customerId)
    .first<{ email_normalized: string; display_name: string }>();
  const dto = mapRequest(row);
  return {
    ...dto,
    requestedBy: {
      membershipId: row.requested_by_membership_id,
      email: member?.email_normalized ?? 'unknown',
      displayName: member?.display_name ?? 'Unknown member',
    },
  };
}

export async function listRequestEvents(
  db: D1Database,
  customerId: string,
  requestId: string,
): Promise<RequestEventDto[]> {
  const rows = await db
    .prepare(
      `SELECT id, request_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
       FROM customer_request_events
       WHERE request_id = ?1 AND customer_id = ?2
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(requestId, customerId)
    .all<EventDbRow>();
  return rows.results.map(mapEvent);
}

export async function getRequestDetail(
  db: D1Database,
  customerId: string,
  requestId: string,
): Promise<CustomerRequestDto | null> {
  const request = await getRequestById(db, customerId, requestId);
  if (!request) return null;
  const events = await listRequestEvents(db, customerId, requestId);
  return { ...request, events };
}

export async function listRequests(
  db: D1Database,
  input: { customerId: string; page: number; pageSize: number; status?: RequestStatus },
): Promise<{ requests: CustomerRequestDto[]; total: number; hasMore: boolean }> {
  const where: string[] = ['customer_id = ?1'];
  const binds: unknown[] = [input.customerId];
  if (input.status) {
    where.push('status = ?' + (binds.length + 1));
    binds.push(input.status);
  }
  const whereSql = where.join(' AND ');

  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM customer_requests WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const rows = await db
    .prepare(
      `${REQUEST_SELECT} WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
    .bind(...binds, input.pageSize, (input.page - 1) * input.pageSize)
    .all<RequestDbRow>();

  const requests = await Promise.all(
    rows.results.map(async (row) => {
      const member = await db
        .prepare(
          `SELECT email_normalized, display_name FROM portal_memberships WHERE id = ?1 AND customer_id = ?2`,
        )
        .bind(row.requested_by_membership_id, input.customerId)
        .first<{ email_normalized: string; display_name: string }>();
      const dto = mapRequest(row);
      return {
        ...dto,
        requestedBy: {
          membershipId: row.requested_by_membership_id,
          email: member?.email_normalized ?? 'unknown',
          displayName: member?.display_name ?? 'Unknown member',
        },
      };
    }),
  );

  const total = count?.total ?? 0;
  return { requests, total, hasMore: input.page * input.pageSize < total };
}

export type CancelOutcome = 'cancelled' | 'not_found' | 'invalid_transition';

export async function cancelRequest(
  db: D1Database,
  input: {
    customerId: string;
    requestId: string;
    actor: RequestActor;
    correlationId: string;
    now?: string;
  },
): Promise<CancelOutcome> {
  const now = input.now ?? isoNow();
  const request = await db
    .prepare(`SELECT id, status FROM customer_requests WHERE id = ?1 AND customer_id = ?2`)
    .bind(input.requestId, input.customerId)
    .first<{ id: string; status: string }>();
  if (!request) return 'not_found';
  if (!canCustomerCancel(request.status as RequestStatus)) return 'invalid_transition';

  const results = await db.batch([
    db
      .prepare(
        `UPDATE customer_requests
         SET status = 'cancelled', cancelled_at = ?1, updated_at = ?1
         WHERE id = ?2 AND customer_id = ?3 AND status = 'submitted'`,
      )
      .bind(now, input.requestId, input.customerId),
    db
      .prepare(
        `INSERT INTO customer_request_events
          (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'cancelled', ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        newId('evt'),
        input.requestId,
        input.customerId,
        actorTypeFor(input.actor),
        input.actor.membershipId,
        'Request cancelled by customer.',
        '{}',
        now,
      ),
    db
      .prepare(
        `INSERT INTO portal_audit_log
          (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
         VALUES (?1, ?2, ?3, 'request.cancel', 'customer_request', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        newId('aud'),
        input.customerId,
        input.actor.email,
        input.requestId,
        JSON.stringify({ via: input.actor.label }),
        input.correlationId,
        now,
      ),
  ]);

  if (results[0].meta.changes === 0) return 'invalid_transition';
  return 'cancelled';
}

export type CommentOutcome = 'added' | 'not_found' | 'invalid_transition';

export async function addCustomerComment(
  db: D1Database,
  input: {
    customerId: string;
    requestId: string;
    actor: RequestActor;
    message: string;
    correlationId: string;
    now?: string;
  },
): Promise<CommentOutcome> {
  const now = input.now ?? isoNow();
  const request = await db
    .prepare(`SELECT id, status FROM customer_requests WHERE id = ?1 AND customer_id = ?2`)
    .bind(input.requestId, input.customerId)
    .first<{ id: string; status: string }>();
  if (!request) return 'not_found';
  if (request.status === 'cancelled') return 'invalid_transition';

  const resubmit = canCustomerResubmit(request.status as RequestStatus);
  const statements = [
    db
      .prepare(
        `INSERT INTO customer_request_events
          (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'comment', ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        newId('evt'),
        input.requestId,
        input.customerId,
        actorTypeFor(input.actor),
        input.actor.membershipId,
        input.message,
        '{}',
        now,
      ),
  ];
  if (resubmit) {
    statements.push(
      db
        .prepare(
          `UPDATE customer_requests
           SET status = 'in_review', updated_at = ?1
           WHERE id = ?2 AND customer_id = ?3 AND status = 'needs_information'`,
        )
        .bind(now, input.requestId, input.customerId),
      db
        .prepare(
          `INSERT INTO customer_request_events
            (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
           VALUES (?1, ?2, ?3, 'status_changed', ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          newId('evt'),
          input.requestId,
          input.customerId,
          actorTypeFor(input.actor),
          input.actor.membershipId,
          'Request resubmitted for review.',
          JSON.stringify({
            previousStatus: 'needs_information',
            resultingStatus: 'in_review',
            principalType: 'customer',
            principalIdentifier: input.actor.membershipId,
          }),
          now,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO portal_audit_log
          (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
         VALUES (?1, ?2, ?3, 'request.comment', 'customer_request', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        newId('aud'),
        input.customerId,
        input.actor.email,
        input.requestId,
        JSON.stringify({ via: input.actor.label, resubmitted: resubmit }),
        input.correlationId,
        now,
      ),
  );

  await db.batch(statements);
  return 'added';
}

export function requestTypeLabel(requestType: RequestType): string {
  return REQUEST_TYPE_LABELS[requestType];
}