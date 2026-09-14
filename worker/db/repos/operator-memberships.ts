import type { MembershipStatus, PortalRole } from '../../../shared/types';
import { ApiError } from '../../api/errors';
import { canonicalJson, isoNow, newId, sha256Hex } from '../../util';
import { normalizeEmail } from '../../util';
import { IDEMPOTENCY_TTL_MS } from './requests';
import type { MembershipRow } from './memberships';

const ROLES: PortalRole[] = ['customer_admin', 'billing_viewer', 'technical_operator', 'read_only'];
const STATUSES: MembershipStatus[] = ['active', 'disabled', 'archived'];

export interface UpsertMembershipInput {
  customerId: string;
  email: string;
  displayName: string;
  role: PortalRole;
  status: MembershipStatus;
  demoExpiresAt: string | null;
  idempotencyKey: string;
  correlationId: string;
}

export type UpsertMembershipResult = {
  membership: MembershipRow;
  replayed: boolean;
};

export async function upsertMembershipForOperator(
  db: D1Database,
  input: UpsertMembershipInput,
): Promise<UpsertMembershipResult> {
  const email = normalizeEmail(input.email);
  const payloadHash = await sha256Hex(
    canonicalJson({
      customerId: input.customerId,
      email,
      displayName: input.displayName,
      role: input.role,
      status: input.status,
      demoExpiresAt: input.demoExpiresAt,
    }),
  );
  const operation = `membership.upsert:${email}`;
  const now = isoNow();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  await db.prepare(`DELETE FROM idempotency_records WHERE customer_id = ?1 AND expires_at < ?2`).bind(input.customerId, now).run();
  const existingIdem = await db
    .prepare(
      `SELECT request_hash, response_status, response_body_json FROM idempotency_records
       WHERE customer_id = ?1 AND operation = ?2 AND idempotency_key = ?3`,
    )
    .bind(input.customerId, operation, input.idempotencyKey)
    .first<{ request_hash: string; response_status: number; response_body_json: string }>();
  if (existingIdem) {
    if (existingIdem.request_hash !== payloadHash) {
      throw new ApiError(409, 'idempotency_conflict', 'Idempotency key reused with a different payload.');
    }
    const parsed = JSON.parse(existingIdem.response_body_json) as { membership: MembershipRow };
    return { membership: parsed.membership, replayed: true };
  }

  const other = await db
    .prepare(
      `SELECT customer_id FROM portal_memberships
       WHERE email_normalized = ?1 AND status = 'active' AND customer_id != ?2 LIMIT 1`,
    )
    .bind(email, input.customerId)
    .first<{ customer_id: string }>();
  if (other) {
    throw new ApiError(409, 'conflict', 'Email is already bound to another customer.');
  }

  const current = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at, demo_expires_at
       FROM portal_memberships WHERE customer_id = ?1 AND email_normalized = ?2`,
    )
    .bind(input.customerId, email)
    .first<{
      id: string;
      customer_id: string;
      email_normalized: string;
      display_name: string;
      role: string;
      status: string;
      created_at: string;
      updated_at: string;
      demo_expires_at: string | null;
    }>();

  const id = current?.id ?? newId('mbr');
  if (current) {
    await db
      .prepare(
        `UPDATE portal_memberships
         SET display_name = ?1, role = ?2, status = ?3, demo_expires_at = ?4, updated_at = ?5
         WHERE id = ?6 AND customer_id = ?7`,
      )
      .bind(input.displayName, input.role, input.status, input.demoExpiresAt, now, id, input.customerId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO portal_memberships
          (id, customer_id, email_normalized, display_name, role, status, created_at, updated_at, demo_expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)`,
      )
      .bind(id, input.customerId, email, input.displayName, input.role, input.status, now, input.demoExpiresAt)
      .run();
  }

  const membership: MembershipRow = {
    id,
    customerId: input.customerId,
    emailNormalized: email,
    displayName: input.displayName,
    role: input.role,
    status: input.status,
    createdAt: current?.created_at ?? now,
    updatedAt: now,
    demoExpiresAt: input.demoExpiresAt,
  };

  await db.batch([
    db.prepare(
      `INSERT INTO portal_audit_log
        (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      newId('aud'),
      input.customerId,
      'service:operator-console',
      current ? 'membership.reactivate' : 'membership.upsert',
      'membership',
      id,
      JSON.stringify({
        emailHash: await sha256Hex(email),
        role: input.role,
        status: input.status,
        idempotencyHash: await sha256Hex(input.idempotencyKey),
      }),
      input.correlationId,
      now,
    ),
    db.prepare(
      `INSERT INTO idempotency_records
        (id, customer_id, operation, idempotency_key, request_hash, response_status, response_body_json, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      newId('idem'),
      input.customerId,
      operation,
      input.idempotencyKey,
      payloadHash,
      200,
      JSON.stringify({ membershipId: membership.id, membership, replayed: false }),
      now,
      expiresAt,
    ),
  ]);

  return { membership, replayed: false };
}

export function parseMembershipRole(value: unknown): PortalRole {
  if (typeof value !== 'string' || !ROLES.includes(value as PortalRole)) {
    throw new ApiError(400, 'invalid_request', 'role is invalid.');
  }
  return value as PortalRole;
}

export function parseMembershipStatus(value: unknown): MembershipStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as MembershipStatus)) {
    throw new ApiError(400, 'invalid_request', 'status is invalid.');
  }
  return value as MembershipStatus;
}
