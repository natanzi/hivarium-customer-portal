/**
 * magic_link_challenges + magic_link_throttle repository.
 *
 * Only SHA-256 hashes are stored: of the 256-bit challenge token, of the
 * normalized request email (throttle key), and of the source IP (throttle
 * key). The raw token exists only in the emailed link; the raw email and
 * raw IP are never persisted. Normalized emails are never returned by this
 * repository — challenge rows carry membership/customer references only.
 *
 * Guarantees relied upon by the sign-in route (future phase):
 *   * single-active-challenge: the partial UNIQUE index enforces at most one
 *     active (unconsumed, not invalidated) challenge per membership; new
 *     attempts invalidate older ones;
 *   * atomic, idempotent consumption: the conditional UPDATE marks a
 *     challenge consumed and binds its session only while it is active, so
 *     exactly one concurrent claimant succeeds;
 *   * deterministic replay resistance: token_hash is UNIQUE so identical
 *     requests cannot mint a second challenge; a replayed token reports the
 *     original bound session (status 'already-consumed', with the session id)
 *     so the route fails closed instead of creating a second one
 *     (portal_sessions.challenge_id is UNIQUE as a final belt-and-braces).
 *
 * Single-active-link replacement (createChallenge) stamps invalidated_at on
 * the older active challenge; invalidated rows are never consumable and are
 * rejected by every find/consume path. consumed_at and consumed_session_id
 * are only ever written together by the atomic claim (the schema CHECK
 * enforces the pairing), so a consumed row always names the session it
 * bound. Expired challenges are reported as expired without being mutated.
 * pruneChallenges() removes long-expired rows.
 */

import { newId, sha256Hex } from '../../util';

/** Default lifetime of a challenge, supplied by the caller when omitted. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type ThrottleReason = 'email' | 'ip';

/**
 * Durable, hashed-keyed throttle state for magic-link requests.
 *
 * Counters live in `magic_link_throttle` keyed by (SHA-256 email hash,
 * SHA-256 IP hash) within aligned rolling windows, so the state survives
 * restarts. Neither the raw email nor the raw source IP is ever stored.
 * Callers must invoke this exactly once per magic-link request and treat
 * `allowed: false` as the reason to refuse generating and sending a link.
 *
 * Window shapes (tunable here, applied at call time):
 *   * email key: per-hour buckets, at most 5 links;
 *   * ip key:    per-minute buckets, at most 10 links.
 */
export async function recordThrottleRequest(
  db: D1Database,
  input: { email: string; sourceIp?: string | null; nowMs?: number },
): Promise<{ allowed: boolean; reason?: ThrottleReason }> {
  const emailHash = await sha256Hex(input.email.trim().toLowerCase());
  const ipHash = input.sourceIp ? await sha256Hex(input.sourceIp) : null;
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();

  const checks: { kind: ThrottleReason; hash: string; windowKey: string; max: number }[] = [
    {
      kind: 'email',
      hash: emailHash,
      windowKey: new Date(nowMs - (nowMs % (3600 * 1000))).toISOString(),
      max: 5,
    },
  ];
  if (ipHash) {
    checks.push({
      kind: 'ip',
      hash: ipHash,
      windowKey: new Date(nowMs - (nowMs % (60 * 1000))).toISOString(),
      max: 10,
    });
  }

  const statements: D1PreparedStatement[] = [];
  for (const check of checks) {
    // Increment (or insert) the counter for this key and window.
    statements.push(
      db
        .prepare(
          `INSERT INTO magic_link_throttle
             (key_hash, key_kind, window_key, request_count, first_request_at, last_request_at)
           VALUES (?1, ?2, ?3, 1, ?4, ?4)
           ON CONFLICT (key_hash, key_kind, window_key)
           DO UPDATE SET request_count = request_count + 1, last_request_at = ?4`,
        )
        .bind(check.hash, check.kind, check.windowKey, now),
    );
    // Read the post-update counter for this window. Keyed by hash/kind/window
    // (the table has a composite primary key) rather than by row id.
    statements.push(
      db
        .prepare(
          `SELECT COALESCE(MAX(request_count), 0) AS c
           FROM magic_link_throttle
           WHERE key_hash = ?1 AND key_kind = ?2 AND window_key = ?3`,
        )
        .bind(check.hash, check.kind, check.windowKey),
    );
  }

  // Prune windows far in the past so the table stays bounded.
  const emailPruneBefore = new Date(nowMs - 2 * 3600 * 1000 - (nowMs % (3600 * 1000))).toISOString();
  const ipPruneBefore = new Date(nowMs - 2 * 60 * 1000 - (nowMs % (60 * 1000))).toISOString();
  statements.push(
    db.prepare(`DELETE FROM magic_link_throttle WHERE key_kind = 'email' AND window_key < ?1`).bind(emailPruneBefore),
  );
  if (ipHash) {
    statements.push(
      db.prepare(`DELETE FROM magic_link_throttle WHERE key_kind = 'ip' AND window_key < ?1`).bind(ipPruneBefore),
    );
  }

  const results = await db.batch(statements);

  // Statements are interleaved per check (increment, then select), so check
  // i's post-update counter is at results[i * 2 + 1]; the prune statements
  // come after all checks.
  for (let i = 0; i < checks.length; i++) {
    const { max } = checks[i];
    const row = (results[i * 2 + 1].results as Array<{ c: number }> | undefined)?.[0];
    if ((row?.c ?? 1) > max) return { allowed: false, reason: checks[i].kind };
  }
  return { allowed: true };
}

export interface ChallengeRow {
  id: string;
  membershipId: string;
  customerId: string;
  createdAt: string;
  expiresAt: string;
}

export type CreateChallengeOutcome =
  | { status: 'created'; challenge: ChallengeRow; token: string }
  | { status: 'throttled' };

/**
 * Creates a sign-in challenge for an email.
 *
 * - Normalizes the email exactly like the membership repository.
 * - Fails closed when the email has zero or multiple active memberships.
 * - Applies durable throttling keyed by the email and IP hashes.
 * - Invalidates any older active challenge for the membership so the user
 *   always has exactly one valid link, and never two valid sessions.
 *
 * The raw 256-bit token is returned exactly once, in memory, for the caller
 * to encode into the emailed link (URLSearchParams, see
 * worker/auth/magic-link-email.ts). Only its SHA-256 hash is persisted —
 * no raw login or session token ever reaches the database.
 */
export async function createChallenge(
  db: D1Database,
  input: {
    email: string;
    sourceIp?: string | null;
    userAgent?: string;
    ttlMs?: number;
    nowMs?: number;
  },
): Promise<CreateChallengeOutcome> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const normalized = input.email.trim().toLowerCase();

  const membership = await db
    .prepare(
      `SELECT id, customer_id FROM portal_memberships
       WHERE email_normalized = ?1 AND status = 'active'
         AND (demo_expires_at IS NULL OR demo_expires_at > ?2)
       ORDER BY created_at ASC
       LIMIT 2`,
    )
    .bind(normalized, now)
    .all<{ id: string; customer_id: string }>();
  if (membership.results.length !== 1) {
    // No (or ambiguous) active membership: fail closed without minting a
    // challenge and without recording throttle state the caller could use
    // to probe which accounts exist.
    return { status: 'throttled' };
  }
  const member = membership.results[0];

  const throttle = await recordThrottleRequest(db, {
    email: normalized,
    sourceIp: input.sourceIp,
    nowMs,
  });
  if (!throttle.allowed) return { status: 'throttled' };

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256Hex(token);
  const ttlMs = input.ttlMs ?? CHALLENGE_TTL_MS;
  const ipHash = input.sourceIp ? await sha256Hex(input.sourceIp) : 'unknown';

  // Invalidate older active challenges (single-active-link semantics). Only
  // the invalidated_at marker is set: consumed_at/consumed_session_id stay
  // paired (both NULL) because no session was bound.
  await db
    .prepare(
      `UPDATE magic_link_challenges
       SET invalidated_at = ?1
       WHERE membership_id = ?2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
    )
    .bind(now, member.id)
    .run();

  const id = newId('mlc');
  await db
    .prepare(
      `INSERT INTO magic_link_challenges
         (id, token_hash, membership_id, customer_id, ip_hash, user_agent, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      id,
      hash,
      member.id,
      member.customer_id,
      ipHash,
      input.userAgent ?? '',
      now,
      new Date(nowMs + ttlMs).toISOString(),
    )
    .run();

  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  return {
    status: 'created',
    challenge: {
      id,
      membershipId: member.id,
      customerId: member.customer_id,
      createdAt: now,
      expiresAt,
    },
    token,
  };
}

export type ConsumeChallengeResult =
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'already-consumed'; challenge: ChallengeRow; sessionId: string | null }
  | { status: 'consumed'; challenge: ChallengeRow };

/**
 * Looks up a challenge by raw token and reports its state without mutating
 * it. Used by the sign-in route to decide how to present failure (and, for
 * consumed tokens, which session the token already bound to) before the
 * atomically idempotent `consumeChallenge` claim.
 */
export type FindChallengeState =
  | { status: 'unknown' }
  | { status: 'valid'; challenge: ChallengeRow }
  | { status: 'expired'; challenge: ChallengeRow }
  | { status: 'replayed'; challenge: ChallengeRow; sessionId: string | null };

export async function findChallengeByToken(
  db: D1Database,
  token: string,
  nowMs?: () => number,
): Promise<FindChallengeState> {
  const hash = await sha256Hex(token);
  const now = new Date(nowMs ? nowMs() : Date.now()).toISOString();

  const row = await db
    .prepare(
      `SELECT id, membership_id, customer_id, created_at, expires_at, consumed_at, consumed_session_id, invalidated_at
       FROM magic_link_challenges
       WHERE token_hash = ?1
       LIMIT 1`,
    )
    .bind(hash)
    .first<{
      id: string;
      membership_id: string | null;
      customer_id: string | null;
      created_at: string;
      expires_at: string;
      consumed_at: string | null;
      consumed_session_id: string | null;
      invalidated_at: string | null;
    }>();
  if (!row || !row.membership_id || !row.customer_id) return { status: 'unknown' };
  if (row.invalidated_at !== null) {
    // Superseded by a newer challenge (single-active-link semantics): never
    // usable, indistinguishable from unknown.
    return { status: 'unknown' };
  }

  const challenge: ChallengeRow = {
    id: row.id,
    membershipId: row.membership_id,
    customerId: row.customer_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  if (row.consumed_at !== null) {
    // Replay: the token already bound a session. The route must fail closed
    // (no cookie, no second session); it must never create a second session
    // for this challenge.
    return { status: 'replayed', challenge, sessionId: row.consumed_session_id };
  }
  if (row.expires_at <= now) return { status: 'expired', challenge };
  return { status: 'valid', challenge };
}

/**
 * Atomically consumes a challenge token exactly once.
 *
 * The conditional UPDATE (`WHERE consumed_at IS NULL AND invalidated_at IS
 * NULL`) is the consumption barrier: under concurrent claims exactly one
 * statement marks the row, so a token can never back more than one session.
 * The caller MUST pass the session row id it is about to create; the binding
 * is recorded inside this claim so the challenge row always references the
 * session that consumed it (the schema CHECK requires consumed_at and
 * consumed_session_id to be written together), and
 * `portal_sessions.challenge_id UNIQUE` makes a second session per challenge
 * impossible.
 *
 * Results:
 *   * 'not-found'        — unknown, ambiguous, or invalidated (superseded)
 *                          challenge; never usable.
 *   * 'expired'          — token has lapsed; reported without mutating the
 *                          row, so no fake consumed state is created.
 *   * 'already-consumed' — replay: a prior claim bound a session. The route
 *                          must fail closed (no cookie, no second session);
 *                          the bound session id is surfaced for diagnostics.
 *   * 'consumed'         — this call performed the single claim; the
 *                          challenge identifies the membership/customer and
 *                          the caller must now create the session row with
 *                          the same id it passed in.
 */
export async function consumeChallenge(
  db: D1Database,
  token: string,
  input: { sessionId: string; nowMs?: (() => number) | number },
): Promise<ConsumeChallengeResult> {
  const hash = await sha256Hex(token);
  const nowMs = typeof input.nowMs === 'function' ? input.nowMs() : typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const now = new Date(nowMs).toISOString();

  const row = await db
    .prepare(
      `SELECT id, membership_id, customer_id, created_at, expires_at, consumed_at, consumed_session_id, invalidated_at
       FROM magic_link_challenges
       WHERE token_hash = ?1
       LIMIT 1`,
    )
    .bind(hash)
    .first<{
      id: string;
      membership_id: string | null;
      customer_id: string | null;
      created_at: string;
      expires_at: string;
      consumed_at: string | null;
      consumed_session_id: string | null;
      invalidated_at: string | null;
    }>();
  if (!row || !row.membership_id || !row.customer_id) return { status: 'not-found' };
  if (row.invalidated_at !== null) {
    // Superseded by a newer challenge: never consumable.
    return { status: 'not-found' };
  }

  if (row.consumed_at !== null) {
    // Deterministic replay: this token was already bound by a prior claim.
    // Never let this mint a second session — surface the bound session id so
    // the route can redirect.
    return {
      status: 'already-consumed',
      challenge: {
        id: row.id,
        membershipId: row.membership_id,
        customerId: row.customer_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
      sessionId: row.consumed_session_id,
    };
  }

  const challenge: ChallengeRow = {
    id: row.id,
    membershipId: row.membership_id,
    customerId: row.customer_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };

  if (row.expires_at <= now) {
    // Expired: report it without mutating the row. Marking it consumed would
    // require a bound session (the CHECK enforces the pairing) and would
    // fabricate a consumed state that never happened.
    return { status: 'expired' };
  }

  // The atomic claim: only active (unconsumed, not invalidated) rows can be
  // flipped, and the claim binds the session id so the pairing CHECK holds.
  const claim = await db
    .prepare(
      `UPDATE magic_link_challenges
       SET consumed_at = ?1, consumed_session_id = ?2
       WHERE id = ?3 AND consumed_at IS NULL AND invalidated_at IS NULL`,
    )
    .bind(now, input.sessionId, row.id)
    .run();

  if (claim.meta.changes === 0) {
    // Lost the race to a concurrent claimant. Refetch to see the winner's
    // state; a replay must never be treated as newly consumed.
    const current = await db
      .prepare(
        `SELECT id, membership_id, customer_id, created_at, expires_at, consumed_at, consumed_session_id, invalidated_at
         FROM magic_link_challenges
         WHERE id = ?1
         LIMIT 1`,
      )
      .bind(row.id)
      .first<{
        id: string;
        membership_id: string | null;
        customer_id: string | null;
        created_at: string;
        expires_at: string;
        consumed_at: string | null;
        consumed_session_id: string | null;
        invalidated_at: string | null;
      }>();
    if (!current || current.invalidated_at !== null || !current.membership_id || !current.customer_id) {
      return { status: 'not-found' };
    }
    return {
      status: 'already-consumed',
      challenge: {
        id: current.id,
        membershipId: current.membership_id,
        customerId: current.customer_id,
        createdAt: current.created_at,
        expiresAt: current.expires_at,
      },
      sessionId: current.consumed_session_id,
    };
  }
  return { status: 'consumed', challenge };
}

/**
 * Prunes challenges that expired long ago. Bounded per call so routes can
 * invoke it opportunistically without paying for an unbounded sweep.
 */
export async function pruneChallenges(db: D1Database, limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const page = await db
    .prepare(`SELECT id FROM magic_link_challenges WHERE expires_at < ?1 ORDER BY expires_at ASC LIMIT ?2`)
    .bind(cutoff, limit)
    .all<{ id: string }>();
  const ids = page.results.map((r) => r.id);
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const result = await db
    .prepare(`DELETE FROM magic_link_challenges WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
  return result.meta.changes;
}
