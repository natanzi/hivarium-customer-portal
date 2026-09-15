/**
 * Magic-link sign-in and first-party session tests.
 *
 * Covers the three authentication contracts:
 *  1. first-party HV_PORTAL_SESSION cookies resolve without any Cloudflare
 *     Access configuration (and machine Bearer credentials still win);
 *  2. the emailed link is exactly origin + /api/auth/verify, and session
 *     cookies carry no invalid Cache-Control pseudo-attribute;
 *  3. verification claims the challenge atomically with the session id
 *     (schema CHECK pairing), creates exactly one session, and replays fail
 *     closed with invalid_link and no cookie.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, appFetch, jsonBody, type TestApp } from './helpers/app';
import { createChallenge } from '../../worker/db/repos/magic-links';
import { buildMagicLinkUrl } from '../../worker/auth/magic-link-email';
import { resolveSessionToken, deleteSession } from '../../worker/db/repos/portal-sessions';
import { createClient, generateCredential } from '../../worker/db/repos/api-clients';
import { sha256Hex } from '../../worker/util';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

async function mintChallenge(email: string): Promise<string> {
  const outcome = await createChallenge(app.harness.db, { email, ttlMs: 10 * 60 * 1000 });
  if (outcome.status !== 'created') throw new Error('challenge not created');
  return outcome.token;
}

function verifyRequest(token: string): Request {
  return new Request('https://portal.test/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

function sessionTokenFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('HV_PORTAL_SESSION=');
  return setCookie.split(';')[0].split('=')[1];
}

describe('magic-link email link', () => {
  it('builds a scanner-safe confirmation URL with the token in the fragment', () => {
    const token = 'a'.repeat(64);
    expect(buildMagicLinkUrl('https://portal.hivarium.dev', token)).toBe(
      `https://portal.hivarium.dev/login/verify#token=${token}`,
    );
    expect(buildMagicLinkUrl('https://portal.hivarium.dev/custom/base', token)).toBe(
      `https://portal.hivarium.dev/login/verify#token=${token}`,
    );
  });
});

describe('magic-link verify (atomic claim + session)', () => {
  it('claims the challenge and creates exactly one session with the same id', async () => {
    const token = await mintChallenge('dev.admin@acme.example');
    const response = await appFetch(app.app)(verifyRequest(token), app.env);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    // Cache-Control stays a response header; it is not a cookie attribute.
    expect(setCookie).not.toContain('Cache-Control');

    const sessionToken = sessionTokenFrom(response);
    const resolved = await resolveSessionToken(app.harness.db, sessionToken);
    expect(resolved).not.toBeNull();
    expect(resolved!.customerId).toBe('acme-dev-001');
    expect(resolved!.membership.id).toBe('mbr-acme-admin-001');

    // The challenge row must be consumed with the same session id (the schema
    // CHECK requires consumed_at and consumed_session_id to be written
    // together; a violation would have failed the request).
    const challenge = await app.harness.db
      .prepare(
        `SELECT consumed_at, consumed_session_id
         FROM magic_link_challenges
         WHERE token_hash = ?1`,
      )
      .bind(await sha256Hex(token))
      .first<{ consumed_at: string; consumed_session_id: string }>();
    expect(challenge).not.toBeNull();
    expect(challenge!.consumed_at).not.toBeNull();
    expect(challenge!.consumed_session_id).toBe(resolved!.session.id);

    // Exactly one session row per challenge.
    const sessions = await app.harness.db
      .prepare(`SELECT COUNT(*) AS c FROM portal_sessions WHERE challenge_id = ?1`)
      .bind(resolved!.session.challengeId)
      .first<{ c: number }>();
    expect(sessions!.c).toBe(1);
  });

  it('replays fail closed with invalid_link and no cookie', async () => {
    const token = await mintChallenge('dev.billing@acme.example');
    const first = await appFetch(app.app)(verifyRequest(token), app.env);
    expect(first.status).toBe(200);
    expect(first.headers.get('set-cookie')).toContain('HV_PORTAL_SESSION=');

    const replay = await appFetch(app.app)(verifyRequest(token), app.env);
    expect(replay.status).toBe(400);
    expect(replay.headers.get('set-cookie')).toBeNull();
  });

  it('rejects malformed tokens without minting a cookie', async () => {
    const response = await appFetch(app.app)(verifyRequest('not-hex'), app.env);
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('first-party session identity', () => {
  it('resolves a valid HV_PORTAL_SESSION without Cloudflare Access config', async () => {
    const token = await mintChallenge('dev.admin@acme.example');
    const verify = await appFetch(app.app)(verifyRequest(token), app.env);
    const sessionToken = sessionTokenFrom(verify);

    const broken = await createTestApp({ missingAuthConfig: true });
    try {
      const response = await appFetch(broken.app)(
        new Request('https://portal.test/api/v1/account/status', {
          headers: { Cookie: `HV_PORTAL_SESSION=${sessionToken}` },
        }),
        broken.env,
      );
      expect(response.status).toBe(200);
      const body = await jsonBody(response);
      expect(body.auth).toBe('session');
      expect((body as { user: { email: string; role: string } }).user.email).toBe('dev.admin@acme.example');
      expect((body as { user: { email: string; role: string } }).user.role).toBe('customer_admin');
      expect((body as { organization: { customerId: string } }).organization.customerId).toBe('acme-dev-001');
    } finally {
      await broken.close();
    }
  });

  it('treats an invalid session as signed out when no Access token is presented', async () => {
    const broken = await createTestApp({ missingAuthConfig: true });
    try {
      const response = await appFetch(broken.app)(
        new Request('https://portal.test/api/v1/account/status', {
          headers: { Cookie: 'HV_PORTAL_SESSION=deadbeef' },
        }),
        broken.env,
      );
      expect(response.status).toBe(401);
      const body = await jsonBody(response);
      expect(body.error).toBe('unauthorized');
    } finally {
      await broken.close();
    }
  });

  it('keeps machine Bearer resolution ahead of the session cookie', async () => {
    const token = await mintChallenge('dev.admin@acme.example');
    const verify = await appFetch(app.app)(verifyRequest(token), app.env);
    const sessionToken = sessionTokenFrom(verify);

    const credential = await generateCredential();
    await createClient(app.harness.db, {
      customerId: 'acme-dev-001',
      name: 'magic-link-test-client',
      credential,
      scopes: ['requests:read'],
    });

    const response = await appFetch(app.app)(
      new Request('https://portal.test/api/v1/account/status', {
        headers: { Authorization: `Bearer ${credential}`, Cookie: `HV_PORTAL_SESSION=${sessionToken}` },
      }),
      app.env,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.auth).toBe('machine');
  });
});

describe('sign-out source correctness', () => {
  it('returns /api/auth/logout for a valid first-party session', async () => {
    const token = await mintChallenge('dev.tech@acme.example');
    const verify = await appFetch(app.app)(verifyRequest(token), app.env);
    const sessionToken = sessionTokenFrom(verify);

    const response = await appFetch(app.app)(
      new Request('https://portal.test/api/v1/account/status', {
        headers: { Cookie: `HV_PORTAL_SESSION=${sessionToken}` },
      }),
      app.env,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body as { signOutUrl: string }).signOutUrl).toBe('/api/auth/logout');
  });

  it('returns Cloudflare logout for a valid Access identity without a session cookie', async () => {
    const accessToken = await app.sign({ email: 'dev.admin@acme.example' });
    const response = await appFetch(app.app)(
      new Request('https://portal.test/api/v1/account/status', {
        headers: { 'Cf-Access-Jwt-Assertion': accessToken },
      }),
      app.env,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body as { signOutUrl: string }).signOutUrl).toBe('/cdn-cgi/access/logout');
  });

  it('returns Cloudflare logout for a stale magic-link cookie with a valid Access identity', async () => {
    // Mint a real session, then revoke it so the cookie is stale but still
    // present on the request. The verified Access identity must win: the
    // sign-out destination is derived from authSource, never from cookie
    // presence.
    const token = await mintChallenge('dev.billing@acme.example');
    const verify = await appFetch(app.app)(verifyRequest(token), app.env);
    const sessionToken = sessionTokenFrom(verify);
    const resolved = await resolveSessionToken(app.harness.db, sessionToken);
    expect(resolved).not.toBeNull();
    await deleteSession(app.harness.db, resolved!.session.id);

    const accessToken = await app.sign({ email: 'dev.admin@acme.example' });
    const response = await appFetch(app.app)(
      new Request('https://portal.test/api/v1/account/status', {
        headers: {
          Cookie: `HV_PORTAL_SESSION=${sessionToken}`,
          'Cf-Access-Jwt-Assertion': accessToken,
        },
      }),
      app.env,
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body as { signOutUrl: string }).signOutUrl).toBe('/cdn-cgi/access/logout');
  });
});

describe('magic-link response security headers', () => {
  function expectSecurityHeaders(response: Response): void {
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  }

  it('applies the full security header set to verify success responses', async () => {
    const token = await mintChallenge('dev.readonly@acme.example');
    const response = await appFetch(app.app)(verifyRequest(token), app.env);
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it('applies the full security header set to verify failure responses', async () => {
    const response = await appFetch(app.app)(verifyRequest('not-hex'), app.env);
    expect(response.status).toBe(400);
    expectSecurityHeaders(response);
  });

  it('applies the full security header set to logout responses', async () => {
    const response = await appFetch(app.app)(
      new Request('https://portal.test/api/auth/logout', { method: 'POST' }),
      app.env,
    );
    expect(response.status).toBe(204);
    expectSecurityHeaders(response);
  });

  it('applies the full security header set to logout method-mismatch redirects', async () => {
    const response = await appFetch(app.app)(new Request('https://portal.test/api/auth/logout'), app.env);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://portal.test/login');
    expectSecurityHeaders(response);
  });
});
