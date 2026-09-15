/** portal_memberships repository — all lookups are tenant-scoped. */

import type { MembershipStatus, PortalRole } from '../../../shared/types';
import { isoNow, newId, normalizeEmail } from '../../util';

export interface MembershipRow {
  id: string;
  customerId: string;
  emailNormalized: string;
  displayName: string;
  role: PortalRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  demoExpiresAt: string | null;
}

interface MembershipDbRow {
  id: string;
  customer_id: string;
  email_normalized: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  demo_expires_at: string | null;
}

function mapMembership(row: MembershipDbRow): MembershipRow {
  return {
    id: row.id,
    customerId: row.customer_id,
    emailNormalized: row.email_normalized,
    displayName: row.display_name,
    role: row.role as PortalRole,
    status: row.status as MembershipStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    demoExpiresAt: row.demo_expires_at,
  };
}

/**
 * Finds the active membership for an email. Returns null when there is no
 * active membership OR when the email maps to more than one active customer
 * (ambiguous tenancy must not guess which customer the user belongs to).
 */
export async function findActiveMembershipByEmail(
  db: D1Database,
  email: string,
  nowMs?: () => number,
): Promise<MembershipRow | null> {
  const normalized = normalizeEmail(email);
  const now = new Date(nowMs ? nowMs() : Date.now()).toISOString();
  const result = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at, demo_expires_at
       FROM portal_memberships
       WHERE email_normalized = ?1 AND status = 'active'
         AND (demo_expires_at IS NULL OR demo_expires_at > ?2)
       ORDER BY created_at ASC
       LIMIT 2`,
    )
    .bind(normalized, now)
    .all<MembershipDbRow>();
  if (result.results.length !== 1) return null;
  return mapMembership(result.results[0]);
}

export async function findMembershipAccessStateByEmail(
  db: D1Database,
  email: string,
  nowMs?: () => number,
): Promise<'none' | 'disabled' | 'expired'> {
  const normalized = normalizeEmail(email);
  const now = new Date(nowMs ? nowMs() : Date.now()).toISOString();
  const result = await db
    .prepare(
      `SELECT status, demo_expires_at FROM portal_memberships WHERE email_normalized = ?1 ORDER BY created_at ASC`,
    )
    .bind(normalized)
    .all<{ status: string; demo_expires_at: string | null }>();
  if (result.results.length === 0) return 'none';
  const expiredActive = result.results.some(
    (row) => row.status === 'active' && row.demo_expires_at !== null && row.demo_expires_at <= now,
  );
  if (expiredActive) return 'expired';
  return 'disabled';
}

/**
 * Finds the active, unexpired membership for a specific
 * (customerId, membershipId) pair. First-party sessions already carry the
 * membership id they were bound to, so this resolves the canonical row
 * without ever guessing tenancy from an email. Returns null unless the
 * membership is still `active` and its demo expiry (when set) is ahead.
 */
export async function findActiveMembershipById(
  db: D1Database,
  customerId: string,
  membershipId: string,
  nowMs?: () => number,
): Promise<MembershipRow | null> {
  const now = new Date(nowMs ? nowMs() : Date.now()).toISOString();
  const row = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at, demo_expires_at
       FROM portal_memberships
       WHERE id = ?1 AND customer_id = ?2 AND status = 'active'
         AND (demo_expires_at IS NULL OR demo_expires_at > ?3)
       LIMIT 1`,
    )
    .bind(membershipId, customerId, now)
    .first<MembershipDbRow>();
  return row ? mapMembership(row) : null;
}

export async function findMembershipById(
  db: D1Database,
  customerId: string,
  membershipId: string,
): Promise<MembershipRow | null> {
  const result = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at
       FROM portal_memberships
       WHERE id = ?1 AND customer_id = ?2`,
    )
    .bind(membershipId, customerId)
    .first<MembershipDbRow>();
  return result ? mapMembership(result) : null;
}

export async function listMembershipsByCustomer(
  db: D1Database,
  customerId: string,
): Promise<MembershipRow[]> {
  const result = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at
       FROM portal_memberships
       WHERE customer_id = ?1
       ORDER BY created_at ASC`,
    )
    .bind(customerId)
    .all<MembershipDbRow>();
  return result.results.map(mapMembership);
}

/**
 * Creates a membership. Intended for operator database tooling and
 * deterministic tests; there is no self-service registration in this MVP.
 */
export async function createMembership(
  db: D1Database,
  input: {
    customerId: string;
    email: string;
    displayName: string;
    role: PortalRole;
    status?: MembershipStatus;
    id?: string;
  },
): Promise<MembershipRow> {
  const now = isoNow();
  const id = input.id ?? newId('mbr');
  const status = input.status ?? 'active';
  await db
    .prepare(
      `INSERT INTO portal_memberships
        (id, customer_id, email_normalized, display_name, role, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(id, input.customerId, normalizeEmail(input.email), input.displayName, input.role, status, now)
    .run();
  return {
    id,
    customerId: input.customerId,
    emailNormalized: normalizeEmail(input.email),
    displayName: input.displayName,
    role: input.role,
    status,
    createdAt: now,
    updatedAt: now,
    demoExpiresAt: null,
  };
}

export async function setMembershipStatus(
  db: D1Database,
  customerId: string,
  membershipId: string,
  status: MembershipStatus,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE portal_memberships
       SET status = ?1, updated_at = ?2
       WHERE id = ?3 AND customer_id = ?4`,
    )
    .bind(status, isoNow(), membershipId, customerId)
    .run();
  return result.meta.changes > 0;
}