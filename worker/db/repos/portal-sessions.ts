/**
 * portal_sessions repository — first-party session tokens.
 *
 * Only the SHA-256 hash of the 256-bit session token is stored; the raw
 * token exists exclusively in the HttpOnly cookie. Each session is created
 * from exactly one consumed magic-link challenge
 * (`challenge_id UNIQUE`), tied to the consuming membership and customer.
 *
 * A session may never outlive the membership's `demo_expires_at` and the
 * caller-supplied `expiresAtIso` cap (24h maximum, enforced by the caller).
 * The repository re-checks both bounds at resolve time in addition to the
 * session's own `expires_at`; any failed check resolves to null and
 * callers must fail closed.
 */

import { isoNow, newId, sha256Hex } from '../../util';

export interface PortalSessionRow {
  id: string;
  challengeId: string;
  customerId: string;
  membershipId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  createdVia: string;
}

interface PortalSessionDbRow {
  id: string;
  token_hash: string;
  challenge_id: string;
  customer_id: string;
  membership_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  created_via: string;
}

function mapSession(row: PortalSessionDbRow): PortalSessionRow {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    customerId: row.customer_id,
    membershipId: row.membership_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    createdVia: row.created_via,
  };
}

/**
 * Creates a session token row. The caller must have consumed a challenge
 * first and passes the challenge id plus the membership/customer it
 * resolved to, along with an expiry no later than the session cap (24h)
 * and no later than the membership's demo expiry.
 */
export async function createSession(
  db: D1Database,
  input: {
    token: string;
    challengeId: string;
    customerId: string;
    membershipId: string;
    expiresAtIso: string;
    id?: string;
  },
): Promise<PortalSessionRow> {
  const id = input.id ?? newId('ses');
  const now = isoNow();
  await db
    .prepare(
      `INSERT INTO portal_sessions
         (id, token_hash, challenge_id, customer_id, membership_id,
          created_at, expires_at, last_seen_at, created_via)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, 'magic_link')`,
    )
    .bind(
      id,
      await sha256Hex(input.token),
      input.challengeId,
      input.customerId,
      input.membershipId,
      now,
      input.expiresAtIso,
    )
    .run();
  return {
    id,
    challengeId: input.challengeId,
    customerId: input.customerId,
    membershipId: input.membershipId,
    createdAt: now,
    expiresAt: input.expiresAtIso,
    lastSeenAt: now,
    createdVia: 'magic_link',
  };
}

/**
 * Resolves a raw session token to its session, membership and customer,
 * enforcing, in order:
 *   * the session exists and has not passed `expires_at`;
 *   * the membership still belongs to the session's customer;
 *   * the membership is still 'active';
 *   * the membership's `demo_expires_at` (when set) is still ahead, so a
 *     session can never outlive a shortened demo even if `expires_at` is
 *     further out.
 *
 * Returns null when any check fails; callers must fail closed.
 */
export async function resolveSessionToken(
  db: D1Database,
  token: string,
  nowMs?: () => number,
): Promise<{ session: PortalSessionRow; customerId: string; membership: { id: string; emailNormalized: string } } | null> {
  const hash = await sha256Hex(token);
  const now = new Date(nowMs ? nowMs() : Date.now()).toISOString();
  const row =
    (await db
      .prepare(
        `SELECT s.id, s.token_hash, s.challenge_id, s.customer_id, s.membership_id,
                s.created_at, s.expires_at, s.last_seen_at, s.created_via,
                m.email_normalized AS m_email
         FROM portal_sessions s
         JOIN portal_memberships m ON m.id = s.membership_id
         WHERE s.token_hash = ?1
           AND s.expires_at > ?2
           AND s.customer_id = m.customer_id
           AND m.status = 'active'
           AND (m.demo_expires_at IS NULL OR m.demo_expires_at > ?3)
         LIMIT 1`,
      )
      .bind(hash, now, now)
      .first<PortalSessionDbRow & { m_email: string }>()) ?? null;

  if (!row) return null;
  return {
    session: mapSession(row),
    customerId: row.customer_id,
    membership: { id: row.membership_id, emailNormalized: row.m_email },
  };
}

/**
 * Records activity for a session. Used opportunistically by the request
 * path; never extends the session past its `expires_at`.
 */
export async function touchSession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare(`UPDATE portal_sessions SET last_seen_at = ?1 WHERE id = ?2`)
    .bind(isoNow(), sessionId)
    .run();
}

/** Revokes a single session (sign-out). Returns whether a row was removed. */
export async function deleteSession(db: D1Database, sessionId: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM portal_sessions WHERE id = ?1`).bind(sessionId).run();
  return result.meta.changes > 0;
}

/**
 * Revokes every active session for a membership (e.g. membership
 * deactivation). Returns the number of sessions removed.
 */
export async function deleteSessionsForMembership(
  db: D1Database,
  customerId: string,
  membershipId: string,
): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM portal_sessions WHERE customer_id = ?1 AND membership_id = ?2`)
    .bind(customerId, membershipId)
    .run();
  return result.meta.changes;
}

/**
 * Deletes sessions that have already passed `expires_at`. Bounded per call
 * (D1/SQLite does not support `DELETE ... LIMIT`); callers may loop until
 * the returned count is below the cap. Operator/tooling use; not exposed
 * over HTTP.
 */
export async function pruneExpiredSessions(db: D1Database, limit = 1000): Promise<number> {
  const now = isoNow();
  const stale = await db
    .prepare(`SELECT id FROM portal_sessions WHERE expires_at <= ?1 ORDER BY expires_at ASC LIMIT ?2`)
    .bind(now, limit)
    .all<{ id: string }>();
  const ids = stale.results.map((r) => r.id);
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const result = await db
    .prepare(`DELETE FROM portal_sessions WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
  return result.meta.changes;
}
