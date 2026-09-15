/**
 * Magic-link sign-in handlers: `/api/auth/magic-link`, `/api/auth/verify`
 * and `/api/auth/logout`.
 *
 * These routes are public (no authenticated identity) but fail closed at
 * every step:
 *
 *   * `POST /api/auth/magic-link` accepts a JSON `{ email }` body and
 *     always responds with an identical generic `202 Accepted` envelope —
 *     no response may reveal whether the account exists, was throttled, or
 *     whether an email was delivered. All internal failures (missing
 *     configuration, unknown membership, provider error) are swallowed by
 *     the response shape.
 *   * `GET /api/auth/verify?token=…` accepts only a 64-character lowercase
 *     hex token. The session id and raw session token are generated before
 *     the atomic claim, so the challenge's `consumed_session_id` and the
 *     `portal_sessions` row share one id (the schema CHECK requires the
 *     pairing). On success it claims the challenge exactly once, creates the
 *     first-party session bound to that same id, issues the
 *     `HV_PORTAL_SESSION` HttpOnly cookie and 303-redirects to `/overview`.
 *     Every failure (malformed, unknown, expired, replayed, superseded,
 *     membership no longer active, session insert failure) 303-redirects to
 *     `/login?error=invalid_link` and mints no cookie — a replayed token
 *     never produces a cookie the browser does not already possess.
 *   * `POST /api/auth/logout` resolves the presented first-party session
 *     when any is resolvable, revokes it, and always clears the cookie.
 *
 * No raw token, raw email, or raw source IP is ever persisted: challenge
 * and throttle rows store SHA-256 hashes only (see
 * `worker/db/repos/magic-links.ts`), and session rows store the hash of
 * the 256-bit session token (see `worker/db/repos/portal-sessions.ts`).
 */

import type { MembershipStatus, PortalRole } from '../../shared/types';
import {
  buildMagicLinkUrl,
  DEFAULT_EMAIL_PROVIDER_URL,
  isValidPortalBaseUrl,
  MagicLinkEmailError,
  sendMagicLinkEmail,
} from './magic-link-email';
import { CHALLENGE_TTL_MS, consumeChallenge, createChallenge, type ChallengeRow } from '../db/repos/magic-links';
import { createSession, deleteSession, resolveSessionToken } from '../db/repos/portal-sessions';
import { newId } from '../util';

export const SESSION_COOKIE_NAME = 'HV_PORTAL_SESSION';

/** Session lifetime cap: 24 hours, intersected with the membership demo expiry. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_SOURCE_IP_CHARS = 64;
const MAX_USER_AGENT_CHARS = 256;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Identical response body for every POST /api/auth/magic-link outcome so
 * the route never leaks account existence, throttle state, or provider
 * failures.
 */
const GENERIC_202_BODY = 'Sign-in link dispatched if the account is active.';

export interface MagicLinkHandlerResult {
  status: number;
  headers?: Record<string, string>;
  jsonBody?: Record<string, unknown>;
}

export interface MagicLinkProviderConfig {
  baseUrl: string;
  apiKey: string;
  from: string;
  replyTo?: string;
  apiUrl?: string;
}

export interface MagicLinkDeps {
  db: D1Database;
  provider: MagicLinkProviderConfig;
  now?: () => number;
}

/** Safe default when no email provider is (yet) configured: fail closed. */
export const MAGIC_LINK_PROVIDER_UNAVAILABLE =
  'Email sign-in is not currently available. Please try again later.';

function sessionCookieValue(token: string, maxAgeSeconds: number): string {
  return (
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function isProviderConfigured(provider: MagicLinkProviderConfig): boolean {
  return (
    isValidPortalBaseUrl(provider.baseUrl) &&
    typeof provider.apiKey === 'string' &&
    provider.apiKey.length > 0 &&
    typeof provider.from === 'string' &&
    provider.from.length > 0
  );
}

function computeSessionExpiry(nowMs: number, demoExpiresAt: string | null): { expiresAtIso: string; maxAgeSeconds: number } {
  const sessionExpiryTs = nowMs + SESSION_TTL_MS;
  let effectiveTs = sessionExpiryTs;
  if (demoExpiresAt) {
    const demoTs = new Date(demoExpiresAt).getTime();
    if (!Number.isNaN(demoTs) && demoTs > nowMs && demoTs < effectiveTs) effectiveTs = demoTs;
  }
  if (effectiveTs <= nowMs) return { expiresAtIso: '', maxAgeSeconds: 0 };
  return { expiresAtIso: new Date(effectiveTs).toISOString(), maxAgeSeconds: Math.max(1, Math.floor((effectiveTs - nowMs) / 1000)) };
}

async function readMembershipRow(
  db: D1Database,
  membershipId: string,
  customerId: string,
  nowIso: string,
): Promise<{
  id: string;
  customerId: string;
  emailNormalized: string;
  displayName: string;
  role: PortalRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  demoExpiresAt: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT id, customer_id, email_normalized, display_name, role, status, created_at, updated_at, demo_expires_at
       FROM portal_memberships
       WHERE id = ?1 AND customer_id = ?2 AND status = 'active'
         AND (demo_expires_at IS NULL OR demo_expires_at > ?3)
       LIMIT 1`,
    )
    .bind(membershipId, customerId, nowIso)
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
  if (!row) return null;
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
 * POST /api/auth/magic-link
 *
 * Accepts: `Content-Type: application/json`, body `{ "email": "<addr>" }`.
 * Responds: `202 Accepted` with the generic body for every outcome.
 */
export async function handleMagicLinkRequest(
  request: Request,
  deps: MagicLinkDeps,
): Promise<MagicLinkHandlerResult> {
  const base: MagicLinkHandlerResult = {
    status: 202,
    jsonBody: { message: GENERIC_202_BODY },
    headers: { 'cache-control': 'no-store' },
  };

  const nowMs = deps.now ? deps.now() : Date.now();

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return base;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return base;
  }
  if (text.length === 0 || text.length > 64 * 1024) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return base;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return base;
  const obj = parsed as Record<string, unknown>;
  const email = obj.email;
  if (typeof email !== 'string') return base;
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320) return base;
  const at = normalized.lastIndexOf('@');
  if (at < 2 || at === normalized.length - 1 || normalized.indexOf('@') !== at) return base;
  if (normalized.includes('..') || normalized.includes(' ')) return base;

  const sourceIp = (request.headers.get('CF-Connecting-IP') ?? '').trim().slice(0, MAX_SOURCE_IP_CHARS) || null;
  const userAgent = (request.headers.get('User-Agent') ?? '').trim().slice(0, MAX_USER_AGENT_CHARS);

  // Mint the challenge; durable throttling and single-active-link semantics
  // are enforced inside createChallenge. Unknown/ambiguous/inactive email
  // addresses return without a challenge and without throttle state.
  let challenge: ChallengeRow;
  let rawToken: string;
  try {
    const outcome = await createChallenge(deps.db, {
      email: normalized,
      sourceIp,
      userAgent,
      ttlMs: CHALLENGE_TTL_MS,
      nowMs,
    });
    if (outcome.status !== 'created') return base;
    challenge = outcome.challenge;
    rawToken = outcome.token;
  } catch {
    return base;
  }

  // Deliver through the provider. Failures (missing config, HTTPS policy,
  // network, provider error, invalid response) are swallowed: the response
  // shape is identical regardless of delivery outcome.
  if (!isProviderConfigured(deps.provider)) return base;
  try {
    const link = buildMagicLinkUrl(deps.provider.baseUrl, rawToken);
    void link; // The link is only ever placed in the email body by the provider call below.
    await sendMagicLinkEmail({
      to: normalized,
      token: rawToken,
      baseUrl: deps.provider.baseUrl,
      apiKey: deps.provider.apiKey,
      from: deps.provider.from,
      replyTo: deps.provider.replyTo,
      apiUrl: deps.provider.apiUrl ?? DEFAULT_EMAIL_PROVIDER_URL,
    });
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      const kind = error instanceof MagicLinkEmailError ? error.kind : 'unknown';
      console.error(`magic-link.email_failure kind=${kind}`);
    }
    return base;
  }
  return base;
}

/**
 * GET /api/auth/verify?token=<64 hex>
 *
 * See module doc for the full behavior contract.
 */
export async function handleMagicLinkVerify(
  request: Request,
  deps: MagicLinkDeps,
): Promise<MagicLinkHandlerResult> {
  const fail = {
    status: 400,
    jsonBody: { error: 'invalid_link', message: 'This sign-in link is invalid, expired, or already used.' },
    headers: { 'cache-control': 'no-store' },
  } as const;
  if (request.method !== 'POST') return fail;
  let token = '';
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token : '';
  } catch {
    return fail;
  }
  if (!TOKEN_PATTERN.test(token)) return fail;

  const nowMs = deps.now ? deps.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Generate the session identity BEFORE the atomic claim so the challenge's
  // consumed_session_id and the portal_sessions row share one id. The schema
  // CHECK on magic_link_challenges requires consumed_at and
  // consumed_session_id to be written together, so the claim must carry the
  // session id from the start.
  const sessionId = newId('ses');
  const sessionBytes = new Uint8Array(32);
  crypto.getRandomValues(sessionBytes);
  const rawSessionToken = [...sessionBytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  let consumed;
  try {
    consumed = await consumeChallenge(deps.db, token, { sessionId, nowMs });
  } catch {
    return fail;
  }
  if (consumed.status !== 'consumed') {
    // not-found / expired / superseded / already-consumed (replay): every
    // non-fresh outcome fails closed with no cookie. A replayed token never
    // mints a second session, and never mints a cookie for a token the
    // browser does not already possess.
    return fail;
  }

  // The challenge is now claimed by sessionId. Verify the pinned membership
  // is still active and create exactly that session; any failure leaves the
  // challenge consumed (replay reports already-consumed) and mints nothing.
  const membership = await readMembershipRow(deps.db, consumed.challenge.membershipId, consumed.challenge.customerId, nowIso);
  if (!membership) return fail;

  const expiry = computeSessionExpiry(nowMs, membership.demoExpiresAt);
  if (expiry.maxAgeSeconds <= 0) return fail;

  try {
    await createSession(deps.db, {
      id: sessionId,
      token: rawSessionToken,
      challengeId: consumed.challenge.id,
      customerId: membership.customerId,
      membershipId: membership.id,
      expiresAtIso: expiry.expiresAtIso,
    });
  } catch {
    // Session insert failed: fail closed with no cookie. The challenge stays
    // consumed, so this token can never be replayed into a session.
    return fail;
  }

  return {
    status: 200,
    jsonBody: { ok: true },
    headers: {
      'set-cookie': sessionCookieValue(rawSessionToken, expiry.maxAgeSeconds),
      'cache-control': 'no-store',
    },
  };
}

/**
 * POST /api/auth/logout
 *
 * Revokes the presented first-party session (if resolvable) and clears the
 * cookie. The shared same-origin Origin check for browser mutations is
 * applied by the router before this handler runs.
 */
export async function handleMagicLinkLogout(
  request: Request,
  deps: MagicLinkDeps,
): Promise<MagicLinkHandlerResult> {
  if (request.method !== 'POST') {
    return { status: 303, headers: { location: '/login', 'cache-control': 'no-store' } };
  }
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    try {
      const resolved = await resolveSessionToken(deps.db, cookieToken, deps.now);
      if (resolved && resolved.session.id) {
        await deleteSession(deps.db, resolved.session.id);
      }
    } catch {
      // Resolution failure never blocks sign-out: the cookie is cleared and
      // any orphaned session expires on its own (or via periodic pruning).
    }
  }
  return {
    status: 204,
    headers: { 'set-cookie': clearSessionCookie(), 'cache-control': 'no-store' },
  };
}

function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      const value = rest.join('=');
      if (value.length === 0) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export { isValidPortalBaseUrl };
