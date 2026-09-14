import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, sessionRequest, machineRequest, jsonBody, appFetch, type TestApp } from './helpers/app';
import { createClient, generateCredential } from '../../worker/db/repos/api-clients';
import { findClientByCredential } from '../../worker/db/repos/api-clients';
import { getRequestDetail, listRequestEvents } from '../../worker/db/repos/requests';
import { listAuditEntriesByCustomer } from '../../worker/db/repos/audit';
import { MemoryOperatorService, MemoryLicenseService } from '../../worker/services/test-adapters';
import { randomIdempotencyKey } from './helpers/jwt';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

const adminToken = () => app.sign({ email: 'dev.admin@acme.example' });
const billingToken = () => app.sign({ email: 'dev.billing@acme.example' });
const techToken = () => app.sign({ email: 'dev.tech@acme.example' });
const readonlyToken = () => app.sign({ email: 'dev.readonly@acme.example' });
const disabledToken = () => app.sign({ email: 'dev.disabled@acme.example' });
const unknownToken = () => app.sign({ email: 'stranger@example.com' });
const globexToken = () => app.sign({ email: 'dev.admin@globex.example' });

describe('authentication and fail-closed behavior', () => {
  it('rejects API requests without a JWT', async () => {
    const response = await appFetch(app.app)(new Request('https://portal.test/api/v1/account/status'), app.env);
    expect(response.status).toBe(401);
    const body = await jsonBody(response);
    expect(body.error).toBe('unauthorized');
  });

  it('rejects a token with an invalid signature', async () => {
    const { keyPair } = app;
    const token = app.sign({ email: 'dev.admin@acme.example' });
    const tampered = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
    void keyPair;
    const response = await sessionRequest(app.app, app.env, tampered, '/api/v1/account/status');
    expect(response.status).toBe(401);
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = app.sign({ email: 'dev.admin@acme.example', iss: 'https://evil.example' });
    const response = await sessionRequest(app.app, app.env, token, '/api/v1/account/status');
    expect(response.status).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    const token = app.sign({ email: 'dev.admin@acme.example', aud: 'other-app' });
    const response = await sessionRequest(app.app, app.env, token, '/api/v1/account/status');
    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = app.sign({ email: 'dev.admin@acme.example', exp: now - 3600, nbf: now - 7200, iat: now - 7200 });
    const response = await sessionRequest(app.app, app.env, token, '/api/v1/account/status');
    expect(response.status).toBe(401);
  });

  it('fails closed (503) when ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing', async () => {
    const broken = await createTestApp({ missingAuthConfig: true });
    try {
      const token = broken.sign({ email: 'dev.admin@acme.example' });
      const response = await sessionRequest(broken.app, broken.env, token, '/api/v1/account/status');
      expect(response.status).toBe(503);
      const body = await jsonBody(response);
      expect(body.error).toBe('service_unavailable');
    } finally {
      await broken.close();
    }
  });

  it('never reveals membership existence through differing errors', async () => {
    const unknown = await sessionRequest(app.app, app.env, unknownToken(), '/api/v1/account/status');
    const disabled = await sessionRequest(app.app, app.env, disabledToken(), '/api/v1/account/status');
    expect(unknown.status).toBe(401);
    expect(disabled.status).toBe(401);
    const a = await jsonBody(unknown);
    const b = await jsonBody(disabled);
    // Correlation ids are per-request; the error code and message must match.
    expect(a.error).toBe(b.error);
    expect(a.message).toBe(b.message);
  });

  it('rejects users without a membership and disabled memberships', async () => {
    expect((await sessionRequest(app.app, app.env, unknownToken(), '/api/v1/account/status')).status).toBe(401);
    expect((await sessionRequest(app.app, app.env, disabledToken(), '/api/v1/account/status')).status).toBe(401);
  });

  it('serves a session account status for a valid member', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/account/status');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.auth).toBe('session');
    expect((body as { user: { email: string; role: string } }).user.email).toBe('dev.admin@acme.example');
    expect((body as { user: { email: string; role: string } }).user.role).toBe('customer_admin');
    expect((body as { organization: { customerId: string; name: string } }).organization.customerId).toBe('acme-dev-001');
  });

  it('sets no-store and security headers on API responses', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/account/status');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Content-Security-Policy')).toContain('default-src');
  });
});

describe('role authorization', () => {
  it('lets customer_admin submit every request type', async () => {
    for (const requestType of ['renewal', 'capacity_increase', 'prepaid_credit', 'agent_access', 'license_support', 'deployment_support', 'general_support']) {
      const payload = requestType === 'agent_access' ? { agentProductId: 'agent-scan-001' }
        : requestType === 'capacity_increase' ? { desiredCapacity: 10 }
        : requestType === 'prepaid_credit' ? { amountTokens: 500 }
        : requestType === 'renewal' ? { desiredTerm: 'annual' }
        : requestType === 'general_support' ? { description: 'A question.' }
        : { issueDescription: 'Something broke.' };
      const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType, payload, idempotencyKey: randomIdempotencyKey() }),
      });
      expect(response.status).toBe(201);
    }
  });

  it('blocks billing_viewer from submitting agent-access requests', async () => {
    const response = await sessionRequest(app.app, app.env, billingToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'agent_access', payload: { agentProductId: 'agent-scan-001' }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(403);
  });

  it('lets billing_viewer submit renewal requests', async () => {
    const response = await sessionRequest(app.app, app.env, billingToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'annual' }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(201);
  });

  it('blocks technical_operator from submitting renewal requests', async () => {
    const response = await sessionRequest(app.app, app.env, techToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'monthly' }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(403);
  });

  it('lets technical_operator submit deployment support', async () => {
    const response = await sessionRequest(app.app, app.env, techToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'deployment_support', payload: { issueDescription: 'Heartbeat stopped.' }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(201);
  });

  it('blocks read_only from submitting anything', async () => {
    const response = await sessionRequest(app.app, app.env, readonlyToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'general_support', payload: { description: 'hi' }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(403);
  });

  it('blocks read_only from commenting and cancelling', async () => {
    const list = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests?pageSize=50');
    const page = await jsonBody(list);
    const submitted = (page as { requests: Array<{ id: string }> }).requests.find((r) => r.id === 'req-acme-submitted-001');
    expect(submitted).toBeDefined();
    const comment = await sessionRequest(app.app, app.env, readonlyToken(), `/api/v1/requests/${submitted!.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'please' }),
    });
    expect(comment.status).toBe(403);
    const cancel = await sessionRequest(app.app, app.env, readonlyToken(), `/api/v1/requests/${submitted!.id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(403);
  });

  it('exposes capabilities per role', async () => {
    const admin = await jsonBody(await sessionRequest(app.app, app.env, adminToken(), '/api/v1/account/status'));
    const readonly = await jsonBody(await sessionRequest(app.app, app.env, readonlyToken(), '/api/v1/account/status'));
    expect((admin as { capabilities: { requestTypes: string[]; canCancel: boolean } }).capabilities.requestTypes.length).toBe(7);
    expect((admin as { capabilities: { requestTypes: string[]; canCancel: boolean } }).capabilities.canCancel).toBe(true);
    expect((readonly as { capabilities: { requestTypes: string[]; canCancel: boolean } }).capabilities.requestTypes).toEqual([]);
    expect((readonly as { capabilities: { requestTypes: string[]; canCancel: boolean } }).capabilities.canCancel).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('rejects cross-tenant reads with the same envelope as not-found', async () => {
    const acme = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests/req-acme-submitted-001');
    const globex = await sessionRequest(app.app, app.env, globexToken(), '/api/v1/requests/req-acme-submitted-001');
    const missing = await sessionRequest(app.app, app.env, globexToken(), '/api/v1/requests/req-does-not-exist');
    expect(acme.status).toBe(200);
    expect(globex.status).toBe(404);
    const g = await jsonBody(globex);
    const m = await jsonBody(missing);
    expect(g.error).toBe(m.error);
    expect(g.message).toBe(m.message);
  });

  it('rejects cross-tenant mutations', async () => {
    const globex = await sessionRequest(app.app, app.env, globexToken(), '/api/v1/requests/req-acme-submitted-001/cancel', { method: 'POST' });
    expect(globex.status).toBe(404);
    const comment = await sessionRequest(app.app, app.env, globexToken(), '/api/v1/requests/req-acme-submitted-001/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi from globex' }),
    });
    expect(comment.status).toBe(404);
  });

  it('rejects cross-tenant list access', async () => {
    const response = await sessionRequest(app.app, app.env, globexToken(), '/api/v1/requests');
    const body = await jsonBody(response);
    const ids = (body as { requests: Array<{ id: string }> }).requests.map((r) => r.id);
    expect(ids.every((id) => id.startsWith('req-globex') || !id.includes('acme'))).toBe(true);
    expect(ids).not.toContain('req-acme-submitted-001');
  });
});

describe('request lifecycle', () => {
  it('creates a request with an initial event atomically and writes audit', async () => {
    const key = randomIdempotencyKey();
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'capacity_increase',
        payload: { desiredCapacity: 15, notes: 'More agents for Q4.' },
        idempotencyKey: key,
      }),
    });
    expect(response.status).toBe(201);
    const body = await jsonBody(response);
    const requestId = (body as { request: { id: string } }).request.id;

    const detail = await getRequestDetail(app.harness.db, 'acme-dev-001', requestId);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('submitted');
    expect(detail!.events!.length).toBe(1);
    expect(detail!.events![0].eventType).toBe('created');

    const audit = await listAuditEntriesByCustomer(app.harness.db, 'acme-dev-001');
    const entry = audit.find((e) => e.targetId === requestId && e.action === 'request.create');
    expect(entry).toBeDefined();
    expect(entry!.actorEmail).toBe('dev.admin@acme.example');
  });

  it('returns the original result for a duplicate idempotency key with the same payload', async () => {
    const key = randomIdempotencyKey();
    const body = {
      requestType: 'renewal',
      payload: { desiredTerm: 'annual' },
      idempotencyKey: key,
    };
    const first = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const second = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = await jsonBody(first);
    const b = await jsonBody(second);
    expect((b as { request: { id: string }; replayed: boolean }).request.id).toBe((a as { request: { id: string } }).request.id);
    expect((b as { request: { id: string }; replayed: boolean }).replayed).toBe(true);
  });

  it('returns conflict for a duplicate idempotency key with a different payload', async () => {
    const key = randomIdempotencyKey();
    const first = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'annual' }, idempotencyKey: key }),
    });
    expect(first.status).toBe(201);
    const second = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'monthly' }, idempotencyKey: key }),
    });
    expect(second.status).toBe(409);
  });

  it('creates exactly one request under a true concurrent duplicate race', async () => {
    const key = randomIdempotencyKey();
    const body = {
      requestType: 'capacity_increase',
      payload: { desiredCapacity: 9 },
      idempotencyKey: key,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    // Exactly one winner; the rest replay the original response.
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 200).length).toBe(4);

    const bodies = await Promise.all(results.map(jsonBody));
    const ids = new Set(bodies.map((b) => (b as { request?: { id: string } }).request?.id ?? ''));
    expect(ids.size).toBe(1);

    const count = await app.harness.db
      .prepare(`SELECT COUNT(*) AS n FROM customer_requests WHERE idempotency_key = ?1`)
      .bind(key)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    const events = await app.harness.db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_request_events e
         JOIN customer_requests r ON r.id = e.request_id
         WHERE r.idempotency_key = ?1`,
      )
      .bind(key)
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
    const audit = await app.harness.db
      .prepare(
        `SELECT COUNT(*) AS n FROM portal_audit_log a
         JOIN customer_requests r ON r.id = a.target_id
         WHERE r.idempotency_key = ?1`,
      )
      .bind(key)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('rejects invalid state transitions (cancelling an approved request)', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests/req-acme-approved-001/cancel', { method: 'POST' });
    expect(response.status).toBe(409);
  });

  it('cancels a submitted request and appends history', async () => {
    const key = randomIdempotencyKey();
    const created = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'general_support', payload: { description: 'Please cancel me.' }, idempotencyKey: key }),
    });
    const requestId = (await jsonBody(created) as { request: { id: string } }).request.id;

    const cancel = await sessionRequest(app.app, app.env, adminToken(), `/api/v1/requests/${requestId}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    const body = await jsonBody(cancel);
    expect((body as { request: { status: string } }).request.status).toBe('cancelled');
    expect((body as { request: { events: unknown[] } }).request.events.length).toBe(2);

    const events = await listRequestEvents(app.harness.db, 'acme-dev-001', requestId);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'cancelled']);
  });

  it('lets the original requester cancel their own submitted request', async () => {
    const key = randomIdempotencyKey();
    const created = await sessionRequest(app.app, app.env, techToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'general_support', payload: { description: 'Cancel me.' }, idempotencyKey: key }),
    });
    const requestId = (await jsonBody(created) as { request: { id: string } }).request.id;
    const cancel = await sessionRequest(app.app, app.env, techToken(), `/api/v1/requests/${requestId}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
  });

  it('blocks non-requester non-admin from cancelling', async () => {
    const response = await sessionRequest(app.app, app.env, billingToken(), '/api/v1/requests/req-acme-submitted-001/cancel', { method: 'POST' });
    expect(response.status).toBe(403);
  });

  it('blocks read_only from cancelling even their own request', async () => {
    // read_only cannot submit, so fabricate a request they "own" directly.
    await app.harness.db
      .prepare(
        `INSERT INTO customer_requests
          (id, customer_id, requested_by_membership_id, request_type, status, title, reason,
           structured_payload_json, idempotency_key, created_at, updated_at)
         VALUES ('req-readonly-own-001', 'acme-dev-001', 'mbr-acme-readonly-001', 'general_support', 'submitted',
                 'Own request', '', '{}', 'seed-readonly-own', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .run();
    const response = await sessionRequest(app.app, app.env, readonlyToken(), '/api/v1/requests/req-readonly-own-001/cancel', { method: 'POST' });
    expect(response.status).toBe(403);
  });

  it('lets a technical_operator cancel their own submitted request', async () => {
    const key = randomIdempotencyKey();
    const created = await sessionRequest(app.app, app.env, techToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'general_support', payload: { description: 'Cancel me.' }, idempotencyKey: key }),
    });
    const requestId = (await jsonBody(created) as { request: { id: string } }).request.id;
    const cancel = await sessionRequest(app.app, app.env, techToken(), `/api/v1/requests/${requestId}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
  });

  it('keeps request history append-only', async () => {
    const before = await listRequestEvents(app.harness.db, 'acme-dev-001', 'req-acme-submitted-001');
    const comment = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests/req-acme-submitted-001/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Any update on the capacity review?' }),
    });
    expect(comment.status).toBe(201);
    const after = await listRequestEvents(app.harness.db, 'acme-dev-001', 'req-acme-submitted-001');
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].eventType).toBe('comment');
    // Append-only: nothing changed in prior rows.
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toEqual(before[i]);
    }
  });

  it('rejects comments on cancelled requests', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests/req-acme-cancelled-001/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'too late' }),
    });
    expect(response.status).toBe(409);
  });

  it('validates payloads server-side', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'capacity_increase', payload: { desiredCapacity: -5 }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(400);
    const body = await jsonBody(response);
    expect((body as { error: string }).error).toBe('validation_error');
  });

  it('rejects unknown request types', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'refund', payload: {}, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(400);
  });
});

describe('browser mutation hardening', () => {
  it('rejects mutations with a cross-origin Origin header', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ requestType: 'renewal', payload: {}, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(403);
  });

  it('rejects non-JSON content types for mutations', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    expect(response.status).toBe(415);
  });

  it('rejects oversized bodies', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'general_support', payload: { description: 'x'.repeat(100_000) }, idempotencyKey: randomIdempotencyKey() }),
    });
    expect(response.status).toBe(413);
  });

  it('never returns stack traces in error responses', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/requests/req-nope', { method: 'GET' });
    const text = await response.text();
    expect(text).not.toContain('at ');
    expect(text).not.toContain('Error:');
  });
});

describe('machine API', () => {
  let credential: string;
  beforeAll(async () => {
    credential = await generateCredential();
    await createClient(app.harness.db, {
      customerId: 'acme-dev-001',
      name: 'Test Scanner Agent',
      credential,
      scopes: ['account:read', 'subscription:read', 'licenses:read', 'agents:read', 'requests:read', 'requests:write'],
    });
  });

  it('authenticates a machine client and never stores the raw credential', async () => {
    const client = await findClientByCredential(app.harness.db, credential);
    expect(client).not.toBeNull();
    expect(client!.credentialPrefix).toMatch(/^hv_/);
    const stored = await app.harness.db
      .prepare('SELECT credential_hash FROM api_clients WHERE id = ?1')
      .bind(client!.id)
      .first<{ credential_hash: string }>();
    expect(stored!.credential_hash).not.toContain(credential);
    expect(stored!.credential_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serves machine account status with scopes', async () => {
    const response = await machineRequest(app.app, app.env, credential, '/api/v1/account/status');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body as { auth: string }).auth).toBe('machine');
    expect((body as { scopes: string[] }).scopes).toContain('requests:write');
  });

  it('rejects unknown machine credentials', async () => {
    const response = await machineRequest(app.app, app.env, 'hv_deadbeefdeadbeefdeadbeef', '/api/v1/account/status');
    expect(response.status).toBe(401);
  });

  it('rejects disabled and expired machine clients', async () => {
    const disabledCredential = await generateCredential();
    await createClient(app.harness.db, {
      customerId: 'acme-dev-001',
      name: 'Disabled Client',
      credential: disabledCredential,
      scopes: ['account:read'],
      status: 'disabled',
    });
    const expiredCredential = await generateCredential();
    await createClient(app.harness.db, {
      customerId: 'acme-dev-001',
      name: 'Expired Client',
      credential: expiredCredential,
      scopes: ['account:read'],
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect((await machineRequest(app.app, app.env, disabledCredential, '/api/v1/account/status')).status).toBe(401);
    expect((await machineRequest(app.app, app.env, expiredCredential, '/api/v1/account/status')).status).toBe(401);
  });

  it('enforces machine scopes', async () => {
    const limitedCredential = await generateCredential();
    await createClient(app.harness.db, {
      customerId: 'acme-dev-001',
      name: 'Read-Only Agent',
      credential: limitedCredential,
      scopes: ['subscription:read'],
    });
    const ok = await machineRequest(app.app, app.env, limitedCredential, '/api/v1/subscription');
    expect(ok.status).toBe(200);
    const forbidden = await machineRequest(app.app, app.env, limitedCredential, '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomIdempotencyKey() },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'annual' } }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('requires an Idempotency-Key for machine request creation', async () => {
    const response = await machineRequest(app.app, app.env, credential, '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'renewal', payload: { desiredTerm: 'annual' } }),
    });
    expect(response.status).toBe(400);
  });

  it('creates machine requests idempotently with audit entries', async () => {
    const key = randomIdempotencyKey();
    const body = { requestType: 'capacity_increase', payload: { desiredCapacity: 20 } };
    const first = await machineRequest(app.app, app.env, credential, '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    const second = await machineRequest(app.app, app.env, credential, '/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = await jsonBody(first);
    const b = await jsonBody(second);
    expect((a as { request: { id: string } }).request.id).toBe((b as { request: { id: string } }).request.id);
    const audit = await listAuditEntriesByCustomer(app.harness.db, 'acme-dev-001');
    const machineEntry = audit.find((e) => e.targetId === (a as { request: { id: string } }).request.id && e.action === 'request.create');
    expect(machineEntry).toBeDefined();
    expect(machineEntry!.actorEmail).toBe('machine:Test Scanner Agent');
  });

  it('rate-limits machine clients with a 429 and Retry-After', async () => {
    const { InMemoryRateLimiter } = await import('../../worker/api/rate-limit');
    const limiter = new InMemoryRateLimiter(2, 60_000);
    const limitedApp = await createTestApp({ rateLimiter: limiter });
    try {
      await createClient(limitedApp.harness.db, {
        customerId: 'acme-dev-001',
        name: 'Burst Client',
        credential: 'hv_burstburstburstburstburstburst',
        scopes: ['account:read'],
      });
      const r1 = await machineRequest(limitedApp.app, limitedApp.env, 'hv_burstburstburstburstburstburst', '/api/v1/account/status');
      const r2 = await machineRequest(limitedApp.app, limitedApp.env, 'hv_burstburstburstburstburstburst', '/api/v1/account/status');
      const r3 = await machineRequest(limitedApp.app, limitedApp.env, 'hv_burstburstburstburstburstburst', '/api/v1/account/status');
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
      expect(r3.headers.get('retry-after')).toBeTruthy();
      const body = await jsonBody(r3);
      expect((body as { error: string }).error).toBe('too_many_requests');
      // Sessions are not subject to the machine limiter.
      const session = await sessionRequest(limitedApp.app, limitedApp.env, limitedApp.sign({ email: 'dev.admin@acme.example' }), '/api/v1/account/status');
      expect(session.status).toBe(200);
    } finally {
      await limitedApp.close();
    }
  });
});

describe('upstream service behavior', () => {
  it('returns a safe 503 when the operator service binding is missing', async () => {
    const broken = await createTestApp({
      operator: new MemoryOperatorService({ failWith: 'missing' }),
      license: new MemoryLicenseService({ failWith: 'missing' }),
    });
    try {
      const response = await sessionRequest(broken.app, broken.env, broken.sign({ email: 'dev.admin@acme.example' }), '/api/v1/subscription');
      expect(response.status).toBe(503);
      const body = await jsonBody(response);
      expect((body as { error: string }).error).toBe('service_unavailable');
    } finally {
      await broken.close();
    }
  });

  it('returns upstream_unavailable for unreachable services', async () => {
    const broken = await createTestApp({
      operator: new MemoryOperatorService({ failWith: 'unreachable' }),
    });
    try {
      const response = await sessionRequest(broken.app, broken.env, broken.sign({ email: 'dev.admin@acme.example' }), '/api/v1/subscription');
      expect(response.status).toBe(503);
      const body = await jsonBody(response);
      expect((body as { error: string }).error).toBe('upstream_unavailable');
    } finally {
      await broken.close();
    }
  });

  it('shows licenses as unavailable when the License Service has no endpoint', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/licenses');
    const body = await jsonBody(response);
    expect((body as { availability: { license: string } }).availability.license).toBe('ok');
    // With a stub license service that returns not_implemented:
    const stub = await createTestApp({
      operator: new MemoryOperatorService(),
      license: new MemoryLicenseService({ failWith: 'not_implemented' }),
    });
    try {
      const r = await sessionRequest(stub.app, stub.env, stub.sign({ email: 'dev.admin@acme.example' }), '/api/v1/licenses');
      expect(r.status).toBe(503);
    } finally {
      await stub.close();
    }
  });

  it('serves overview with unavailable sections instead of fabricating data', async () => {
    const broken = await createTestApp({
      operator: new MemoryOperatorService({ failWith: 'missing' }),
      license: new MemoryLicenseService({ failWith: 'missing' }),
    });
    try {
      const response = await sessionRequest(broken.app, broken.env, broken.sign({ email: 'dev.admin@acme.example' }), '/api/v1/overview');
      expect(response.status).toBe(200);
      const body = await jsonBody(response);
      expect((body as { availability: { operator: string; license: string } }).availability.operator).toBe('missing');
      expect((body as { organization: { name: string | null } }).organization.name).toBeNull();
      expect((body as { requests: { outstanding: number } }).requests.outstanding).toBeGreaterThanOrEqual(0);
    } finally {
      await broken.close();
    }
  });

  it('serves usage as prepaid for prepaid customers', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/usage');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body as { kind: string }).kind).toBe('prepaid');
    expect((body as { balanceTokens: number }).balanceTokens).toBe(4250);
  });

  it('serves commercial usage for non-prepaid customers', async () => {
    const commercial = new MemoryOperatorService();
    const original = commercial.getCommercial.bind(commercial);
    commercial.getCommercial = async () => ({
      ok: true,
      value: {
        customerId: 'acme-dev-001',
        asOf: '2026-09-01T00:00:00.000Z',
        active: [
          {
            id: 'arr-monthly-2026',
            model: 'monthly_subscription',
            status: 'active',
            effectiveDate: '2026-01-01T00:00:00.000Z',
            endDate: null,
            renewalDate: '2026-10-01T00:00:00.000Z',
            seatCapacity: 10,
            agentCapacity: 4,
            prepaidBalanceTokens: null,
            warningThresholdTokens: null,
            contractReference: 'HV-M-2026',
            deploymentModel: 'cloud',
            bareMetal: false,
            offlineAllowed: false,
          },
        ],
        scheduled: [],
        history: [],
      },
    });
    void original;
    const monthly = await createTestApp({ operator: commercial });
    try {
      const response = await sessionRequest(monthly.app, monthly.env, monthly.sign({ email: 'dev.admin@acme.example' }), '/api/v1/usage');
      expect(response.status).toBe(200);
      const body = await jsonBody(response);
      expect((body as { kind: string }).kind).toBe('commercial');
      expect((body as { summary: { netTokensConsumed: number } }).summary.netTokensConsumed).toBe(750);
    } finally {
      await monthly.close();
    }
  });
});

describe('root behavior and static assets', () => {
  it('redirects the root route to /overview for browsers', async () => {
    const response = await appFetch(app.app)(
      new Request('https://portal.test/', { headers: { Accept: 'text/html' } }),
      app.env,
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('https://portal.test/overview');
  });

  it('returns not_found for unknown API routes', async () => {
    const response = await sessionRequest(app.app, app.env, adminToken(), '/api/v1/definitely-not-a-route');
    expect(response.status).toBe(404);
  });

  it('serves health without auth', async () => {
    const response = await appFetch(app.app)(new Request('https://portal.test/api/health'), app.env);
    expect(response.status).toBe(200);
  });
});